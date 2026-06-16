import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerEmailScriptTools } from './email-scripts.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

function ref(value: string, display = value) {
  return { value, display_value: display };
}

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn().mockResolvedValue({
      sys_id: ref(EXISTING_SYS_ID),
      name: ref('incident_details'),
      new_lines_to_html: ref('false'),
      script: ref('template.print("hi");'),
    }),
    getInstanceUrl: vi.fn().mockReturnValue('https://pdi.service-now.com'),
  } as unknown as ServiceNowClient;
}

describe('email-script tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerEmailScriptTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_email_script', () => {
    it('creates a script and tells you the ${mail_script} token', async () => {
      const result = await mcpClient.callTool({
        name: 'create_email_script',
        arguments: {
          name: 'incident_details',
          script:
            '(function runMailScript(current, template){ template.print(current.number); })(current, template);',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('${mail_script:incident_details}');
      expect(result.isError).toBeFalsy();
    });

    it('serialises new_lines_to_html default to a string', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerEmailScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_email_script',
          arguments: { name: 'foo', script: 'template.print("x");' },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_email',
          expect.objectContaining({
            name: 'foo',
            script: 'template.print("x");',
            new_lines_to_html: 'false',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns existing record without creating when name exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerEmailScriptTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_email_script',
          arguments: { name: 'incident_details' },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(500, 'Internal Server Error', 'fault', 'https://x'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerEmailScriptTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_email_script',
          arguments: { name: 'X' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_email_script', () => {
    it('patches the record and warns on rename', async () => {
      const result = await mcpClient.callTool({
        name: 'update_email_script',
        arguments: { sys_id: EXISTING_SYS_ID, name: 'renamed_script' },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain('${mail_script:renamed_script}');
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_email_script',
        arguments: { sys_id: 'not-valid', name: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('returns no-op message when only sys_id is provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_email_script',
        arguments: { sys_id: EXISTING_SYS_ID },
      });
      expect(firstText(result)).toContain('No fields to update');
    });
  });

  describe('list_email_scripts', () => {
    it('returns a no-match message when nothing matches', async () => {
      const result = await mcpClient.callTool({
        name: 'list_email_scripts',
        arguments: { name_contains: 'zzz' },
      });
      expect(firstText(result)).toContain('No email scripts matched');
    });
  });

  describe('get_email_script', () => {
    it('returns a two-block rich result with summary then JSON', async () => {
      const result = (await mcpClient.callTool({
        name: 'get_email_script',
        arguments: { sys_id: EXISTING_SYS_ID },
      })) as { content: Array<{ type: string; text: string }> };
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Email Script');
      expect(result.content[0].text).toContain(
        '${mail_script:incident_details}',
      );
      const parsed = JSON.parse(result.content[1].text);
      expect(parsed.sys_id).toBe(EXISTING_SYS_ID);
      expect(parsed.name).toBe('incident_details');
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_email_script',
        arguments: { sys_id: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });
});
