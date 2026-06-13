import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerScriptActionTools } from './script-actions.js';

const NEW_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const EXISTING_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

const ref = (value: string) => ({ value, display_value: value });

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
  } as unknown as ServiceNowClient;
}

describe('script action tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerScriptActionTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_script_action', () => {
    it('applies active/synchronous defaults and string-coerces them', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScriptActionTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_script_action',
          arguments: {
            name: 'Handle Thing',
            event_name: 'x_acme.thing.done',
            script: 'gs.info(event.parm1);',
          },
        });
        expect(firstText(result)).toContain('Script action created');
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysevent_script_action',
          expect.objectContaining({
            name: 'Handle Thing',
            event_name: 'x_acme.thing.done',
            active: 'true',
            synchronous: 'false',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('is idempotent on name + event_name', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerScriptActionTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_script_action',
          arguments: {
            name: 'Handle Thing',
            event_name: 'x_acme.thing.done',
            script: 'gs.info(1);',
          },
        });
        expect(firstText(result)).toContain('already exists');
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_script_action', () => {
    it('rejects an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_script_action',
        arguments: { sys_id: 'bad', active: false },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('patches supplied fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScriptActionTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_script_action',
          arguments: { sys_id: EXISTING_SYS_ID, active: false, order: 200 },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sysevent_script_action',
          EXISTING_SYS_ID,
          { active: 'false', order: '200' },
        );
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('list_script_actions', () => {
    it('summarizes matches with sync/async tag', async () => {
      const listClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: ref(NEW_SYS_ID),
            name: ref('Handle Thing'),
            event_name: ref('x_acme.thing.done'),
            active: ref('true'),
            synchronous: ref('false'),
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerScriptActionTools, listClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_script_actions',
          arguments: { event_name: 'x_acme.thing.done' },
        });
        const text = firstText(result);
        expect(text).toContain('Handle Thing');
        expect(text).toContain('async');
      } finally {
        await pair.teardown();
      }
    });
  });
});
