import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerClientScriptTools } from './client-scripts.js';

const EXISTING_SCRIPT_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SCRIPT_SYS_ID = 'dddd3333eeee4444dddd3333eeee4444';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: NEW_SCRIPT_SYS_ID, display_value: NEW_SCRIPT_SYS_ID },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceNowClient;
}

describe('client-script tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerClientScriptTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_client_script', () => {
    it('creates the script and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_client_script',
        arguments: {
          name: 'Hide field on load',
          table: 'incident',
          type: 'onLoad',
          script: 'function onLoad() { g_form.setDisplay("priority", false); }',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created successfully');
      expect(text).toContain(NEW_SCRIPT_SYS_ID);
      expect(text).toContain('Hide field on load');
      expect(result.isError).toBeFalsy();
    });

    it('maps defaults and ui_type to serialised strings', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerClientScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_client_script',
          arguments: {
            name: 'My Script',
            table: 'change_request',
            type: 'onLoad',
            script: 'function onLoad() {}',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_client',
          expect.objectContaining({
            name: 'My Script',
            table: 'change_request',
            type: 'onLoad',
            active: 'true',
            ui_type: '10',
            global: 'true',
            applies_extended: 'false',
            isolate_script: 'true',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('passes field through for onChange scripts', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerClientScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_client_script',
          arguments: {
            name: 'React to category',
            table: 'incident',
            type: 'onChange',
            field: 'category',
            script:
              'function onChange(control, oldValue, newValue, isLoading) {}',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_client',
          expect.objectContaining({ type: 'onChange', field: 'category' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when onChange omits field', async () => {
      const result = await mcpClient.callTool({
        name: 'create_client_script',
        arguments: {
          name: 'No field',
          table: 'incident',
          type: 'onChange',
          script: 'function onChange() {}',
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('field is required');
    });

    it('returns existing record without creating when name+table already exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: EXISTING_SCRIPT_SYS_ID,
              display_value: EXISTING_SCRIPT_SYS_ID,
            },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerClientScriptTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_client_script',
          arguments: {
            name: 'My Script',
            table: 'incident',
            type: 'onLoad',
            script: 'function onLoad() {}',
          },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SCRIPT_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
        expect(result.isError).toBeFalsy();
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
            new SnApiError(
              500,
              'Internal Server Error',
              'fault',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerClientScriptTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_client_script',
          arguments: {
            name: 'My Script',
            table: 'incident',
            type: 'onLoad',
            script: 'function onLoad() {}',
          },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('500');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects empty name with Zod validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_client_script',
        arguments: {
          name: '',
          table: 'incident',
          type: 'onLoad',
          script: 'function onLoad() {}',
        },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('update_client_script', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_client_script',
        arguments: {
          sys_id: EXISTING_SCRIPT_SYS_ID,
          name: 'Renamed Script',
          active: false,
        },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_SCRIPT_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('serialises ui_type and booleans correctly', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerClientScriptTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_client_script',
          arguments: {
            sys_id: EXISTING_SCRIPT_SYS_ID,
            ui_type: 'mobile',
            active: false,
          },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_script_client',
          EXISTING_SCRIPT_SYS_ID,
          expect.objectContaining({ ui_type: '1', active: 'false' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_client_script',
        arguments: { sys_id: 'not-a-valid-id', name: 'x' },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid');
    });

    it('returns no-op message when no fields are provided besides sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_client_script',
        arguments: { sys_id: EXISTING_SCRIPT_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('No fields to update');
      expect(result.isError).toBeFalsy();
    });

    it('surfaces SnApiError as isError with status in message', async () => {
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
      const pair = await buildTestPair(registerClientScriptTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_client_script',
          arguments: { sys_id: EXISTING_SCRIPT_SYS_ID, name: 'New Name' },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('404');
      } finally {
        await pair.teardown();
      }
    });
  });
});
