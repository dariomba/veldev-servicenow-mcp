import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerFixScriptTools } from './fix-scripts.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';
const TRIGGER_SYS_ID = 'eeee5555ffff6666eeee5555ffff6666';
const TRIGGER_NAME = 'MCP_Script_1717600000000';
const NEXT_ACTION = '05/06/2026 10:00:01';

const SAMPLE_SCRIPT = [
  "var gr = new GlideRecord('incident');",
  "gr.addQuery('active', true);",
  'gr.query();',
  'gs.info(gr.getRowCount());',
].join('\n');

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: NEW_SYS_ID, display_value: NEW_SYS_ID },
      name: { value: 'Test Fix Script', display_value: 'Test Fix Script' },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue({
      success: true,
      trigger_sys_id: TRIGGER_SYS_ID,
      trigger_name: TRIGGER_NAME,
      next_action: NEXT_ACTION,
      message: `Script scheduled to run at ${NEXT_ACTION} (UTC).`,
    }),
  } as unknown as ServiceNowClient;
}

describe('fix-script tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerFixScriptTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  // ── create_fix_script ──────────────────────────────────────────────────────

  describe('create_fix_script', () => {
    it('creates the record and returns sys_id with metadata', async () => {
      const result = await mcpClient.callTool({
        name: 'create_fix_script',
        arguments: { name: 'Test Fix Script', script: SAMPLE_SCRIPT },
      });
      const text = firstText(result);
      expect(text).toContain('Fix Script created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('Test Fix Script');
      expect(result.isError).toBeFalsy();
    });

    it('sends the record to the sys_script_fix table', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerFixScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_fix_script',
          arguments: { name: 'MyFix', script: SAMPLE_SCRIPT },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_fix',
          expect.objectContaining({ name: 'MyFix', script: SAMPLE_SCRIPT }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('serialises boolean fields as strings in the request body', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerFixScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_fix_script',
          arguments: {
            name: 'MyFix',
            script: SAMPLE_SCRIPT,
            record_for_rollback: false,
            before: true,
            unloadable: true,
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_fix',
          expect.objectContaining({
            record_for_rollback: 'false',
            before: 'true',
            unloadable: 'true',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('applies default values (record_for_rollback=true, before=false, unloadable=false)', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerFixScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_fix_script',
          arguments: { name: 'MyFix', script: SAMPLE_SCRIPT },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_fix',
          expect.objectContaining({
            record_for_rollback: 'true',
            before: 'false',
            unloadable: 'false',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('skips creation and returns existing sys_id when name already exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: EXISTING_SYS_ID,
              display_value: EXISTING_SYS_ID,
            },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerFixScriptTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_fix_script',
          arguments: { name: 'Existing Fix', script: SAMPLE_SCRIPT },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError as isError with HTTP status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(403, 'Forbidden', 'ACL', 'https://example.com'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerFixScriptTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_fix_script',
          arguments: { name: 'MyFix', script: SAMPLE_SCRIPT },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects empty script with a Zod validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_fix_script',
        arguments: { name: 'MyFix', script: '' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ── update_fix_script ──────────────────────────────────────────────────────

  describe('update_fix_script', () => {
    it('patches the record and reports success with the sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_fix_script',
        arguments: { sys_id: EXISTING_SYS_ID, description: 'Updated' },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('only sends fields that were explicitly provided', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerFixScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_fix_script',
          arguments: { sys_id: EXISTING_SYS_ID, script: SAMPLE_SCRIPT },
        });
        const body = (mockClient.patchRecord as ReturnType<typeof vi.fn>).mock
          .calls[0][2] as Record<string, unknown>;
        expect(Object.keys(body)).toEqual(['script']);
        expect(body.script).toBe(SAMPLE_SCRIPT);
      } finally {
        await pair.teardown();
      }
    });

    it('serialises boolean fields as strings when provided', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerFixScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_fix_script',
          arguments: {
            sys_id: EXISTING_SYS_ID,
            record_for_rollback: false,
            before: true,
          },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_script_fix',
          EXISTING_SYS_ID,
          expect.objectContaining({
            record_for_rollback: 'false',
            before: 'true',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid 32-char hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_fix_script',
        arguments: { sys_id: 'not-valid', description: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('surfaces SnApiError as isError with HTTP status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        patchRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              404,
              'Not Found',
              'no record',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerFixScriptTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_fix_script',
          arguments: { sys_id: EXISTING_SYS_ID, active: false },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('404');
      } finally {
        await pair.teardown();
      }
    });
  });

  // ── run_fix_script ─────────────────────────────────────────────────────────

  describe('run_fix_script', () => {
    it('schedules the fix script and returns trigger details', async () => {
      const result = await mcpClient.callTool({
        name: 'run_fix_script',
        arguments: { sys_id: EXISTING_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('execution scheduled');
      expect(text).toContain(EXISTING_SYS_ID);
      expect(text).toContain(TRIGGER_SYS_ID);
      expect(text).toContain(TRIGGER_NAME);
      expect(text).toContain(NEXT_ACTION);
      expect(result.isError).toBeFalsy();
    });

    it('passes a runner script containing the sys_id to executeBackgroundScriptTrigger', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerFixScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'run_fix_script',
          arguments: { sys_id: EXISTING_SYS_ID },
        });
        const calledScript = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(calledScript).toContain(EXISTING_SYS_ID);
        expect(calledScript).toContain('sys_script_fix');
        expect(calledScript).toContain('GlideScopedEvaluator');
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid 32-char hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'run_fix_script',
        arguments: { sys_id: 'bad-id' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('surfaces SnApiError as isError with HTTP status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        executeBackgroundScriptTrigger: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              403,
              'Forbidden',
              'insufficient privileges',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerFixScriptTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'run_fix_script',
          arguments: { sys_id: EXISTING_SYS_ID },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });
});
