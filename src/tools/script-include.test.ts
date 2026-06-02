import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerScriptIncludeTools } from '../tools/script-include.js';

const EXISTING_SI_SYS_ID = 'dddd1111eeee2222dddd1111eeee2222';
const NEW_SI_SYS_ID = 'eeee3333ffff4444eeee3333ffff4444';

const SAMPLE_SCRIPT = `var MyUtils = Class.create();
MyUtils.prototype = {
  initialize: function() {},
  type: 'MyUtils'
};`;

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: NEW_SI_SYS_ID, display_value: NEW_SI_SYS_ID },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceNowClient;
}

describe('script-include tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerScriptIncludeTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_script_include', () => {
    it('creates the record and returns sys_id with metadata', async () => {
      const result = await mcpClient.callTool({
        name: 'create_script_include',
        arguments: {
          name: 'MyUtils',
          script: SAMPLE_SCRIPT,
        },
      });
      const text = firstText(result);
      expect(text).toContain('Script Include created');
      expect(text).toContain(NEW_SI_SYS_ID);
      expect(text).toContain('MyUtils');
      expect(result.isError).toBeFalsy();
    });

    it('sets api_name equal to name on createRecord', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScriptIncludeTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_script_include',
          arguments: { name: 'CatalogAjaxUtils', script: SAMPLE_SCRIPT },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script_include',
          expect.objectContaining({
            name: 'CatalogAjaxUtils',
            api_name: 'CatalogAjaxUtils',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns existing record without creating when name already exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: EXISTING_SI_SYS_ID,
              display_value: EXISTING_SI_SYS_ID,
            },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerScriptIncludeTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_script_include',
          arguments: { name: 'MyUtils', script: SAMPLE_SCRIPT },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SI_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(403, 'Forbidden', 'ACL', 'https://example.com'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerScriptIncludeTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_script_include',
          arguments: { name: 'MyUtils', script: SAMPLE_SCRIPT },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_script_include', () => {
    it('patches the record and returns success', async () => {
      const result = await mcpClient.callTool({
        name: 'update_script_include',
        arguments: {
          sys_id: EXISTING_SI_SYS_ID,
          description: 'Updated description',
        },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_SI_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('sets api_name alongside name when name is updated', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScriptIncludeTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_script_include',
          arguments: { sys_id: EXISTING_SI_SYS_ID, name: 'RenamedUtils' },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_script_include',
          EXISTING_SI_SYS_ID,
          expect.objectContaining({
            name: 'RenamedUtils',
            api_name: 'RenamedUtils',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_script_include',
        arguments: { sys_id: 'not-valid', script: SAMPLE_SCRIPT },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid');
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
      const pair = await buildTestPair(registerScriptIncludeTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_script_include',
          arguments: { sys_id: EXISTING_SI_SYS_ID, active: false },
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
