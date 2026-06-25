import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerLogTools } from './logs.js';

const LOG_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    getRecord: vi.fn().mockResolvedValue({
      sys_id: { value: LOG_SYS_ID, display_value: LOG_SYS_ID },
      sys_class_name: { value: 'syslog', display_value: 'Log Entry' },
      level: { value: '2', display_value: 'Error' },
      source: { value: 'MyScriptInclude', display_value: 'MyScriptInclude' },
      message: {
        value: 'TypeError: cannot read property foo of null',
        display_value: 'TypeError: cannot read property foo of null',
      },
      context_map: {
        value: '{"_scope":"global"}',
        display_value: '{"_scope":"global"}',
      },
      sequence: {
        value: '19eefed72330000002',
        display_value: '19eefed72330000002',
      },
      sys_created_on: {
        value: '2026-06-22 15:22:56',
        display_value: '2026-06-22 08:22:56',
      },
      sys_created_by: { value: 'admin', display_value: 'admin' },
    }),
    getInstanceUrl: vi.fn().mockReturnValue('https://pdi.service-now.com'),
  } as unknown as ServiceNowClient;
}

describe('log tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerLogTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('list_logs', () => {
    it('maps min_level and minutes to the right encoded-query clauses', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerLogTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'list_logs',
          arguments: { min_level: 'warning', minutes: 60 },
        });
        const calls = (mockClient.listRecords as ReturnType<typeof vi.fn>).mock
          .calls;
        expect(calls[0][0]).toBe('syslog');
        const query = calls[0][1] as string;
        expect(query).toContain('levelIN1,2,3');
        expect(query).toContain('sys_created_onRELATIVEGE@minute@ago@60');
        expect(query).toContain('ORDERBYDESCsys_created_on');
      } finally {
        await pair.teardown();
      }
    });

    it('maps scope=scoped to the syslog_app_scope class clause', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerLogTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'list_logs',
          arguments: { scope: 'scoped' },
        });
        const query = (mockClient.listRecords as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as string;
        expect(query).toContain('sys_class_name=syslog_app_scope');
      } finally {
        await pair.teardown();
      }
    });

    it('returns a no-match message when nothing matches', async () => {
      const result = await mcpClient.callTool({
        name: 'list_logs',
        arguments: { min_level: 'fatal' },
      });
      expect(firstText(result)).toContain('No log entries matched');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('get_log', () => {
    it('returns a two-block rich result with summary then JSON', async () => {
      const result = (await mcpClient.callTool({
        name: 'get_log',
        arguments: { sys_id: LOG_SYS_ID },
      })) as { content: Array<{ type: string; text: string }> };
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Log Entry');
      const parsed = JSON.parse(result.content[1].text);
      expect(parsed.sys_id).toBe(LOG_SYS_ID);
      expect(parsed.level).toBe('Error');
      expect(parsed.source).toBe('MyScriptInclude');
      expect(parsed.url).toContain('syslog.do');
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_log',
        arguments: { sys_id: 'not-a-sys-id' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        getRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(404, 'Not Found', 'no record', 'https://x'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerLogTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'get_log',
          arguments: { sys_id: LOG_SYS_ID },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('404');
      } finally {
        await pair.teardown();
      }
    });
  });
});
