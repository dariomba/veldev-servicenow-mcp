import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerCatalogClientScriptTools } from '../tools/catalog-client-script.js';

const ITEM_SYS_ID = '7bad3ce593700310eb4cf83bdd03d69d';
const NEW_SCRIPT_SYS_ID = 'aaaa2222bbbb3333aaaa2222bbbb3333';
const EXISTING_SCRIPT_SYS_ID = 'cccc4444dddd5555cccc4444dddd5555';
const VAR_SYS_ID = 'eeee6666ffff7777eeee6666ffff7777';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: NEW_SCRIPT_SYS_ID, display_value: NEW_SCRIPT_SYS_ID },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue(undefined),
  } as unknown as ServiceNowClient;
}

describe('catalog-client-script tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerCatalogClientScriptTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('batch_create_catalog_client_scripts', () => {
    it('creates scripts and returns sys_ids in summary', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_catalog_client_scripts',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          scripts: [
            {
              name: 'Set Default Priority',
              type: 'onLoad',
              script: 'function onLoad() { g_form.setValue("priority", "3"); }',
            },
          ],
        },
      });
      const text = firstText(result);
      expect(text).toContain('Created: 1');
      expect(text).toContain(NEW_SCRIPT_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('skips existing scripts and reports them in the summary', async () => {
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
        registerCatalogClientScriptTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_catalog_client_scripts',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            scripts: [
              {
                name: 'Set Default Priority',
                type: 'onLoad',
                script: 'function onLoad() {}',
              },
            ],
          },
        });
        const text = firstText(result);
        expect(text).toContain('Skipped');
        expect(text).toContain(EXISTING_SCRIPT_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when catalog_item_sys_id is not a valid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_catalog_client_scripts',
        arguments: {
          catalog_item_sys_id: 'bad-id',
          scripts: [
            { name: 'x', type: 'onLoad', script: 'function onLoad() {}' },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid');
    });

    it('returns isError when onChange script has no cat_variable', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_catalog_client_scripts',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          scripts: [
            {
              name: 'On Change Script',
              type: 'onChange',
              script:
                'function onChange(control, oldValue, newValue, isLoading) { if (isLoading) return; }',
              // cat_variable intentionally omitted
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('cat_variable is required');
    });

    it('triggers background script when onChange scripts are created', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerCatalogClientScriptTools,
        mockClient,
      );
      try {
        await pair.mcpClient.callTool({
          name: 'batch_create_catalog_client_scripts',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            scripts: [
              {
                name: 'On Priority Change',
                type: 'onChange',
                script:
                  'function onChange(control, oldValue, newValue, isLoading) { if (isLoading) return; }',
                cat_variable: `IO:${VAR_SYS_ID}`,
              },
            ],
          },
        });
        expect(
          mockClient.executeBackgroundScriptTrigger,
        ).toHaveBeenCalledOnce();
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
      const pair = await buildTestPair(
        registerCatalogClientScriptTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_catalog_client_scripts',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            scripts: [
              { name: 'x', type: 'onLoad', script: 'function onLoad() {}' },
            ],
          },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_catalog_client_script', () => {
    it('patches the record and returns success', async () => {
      const result = await mcpClient.callTool({
        name: 'update_catalog_client_script',
        arguments: {
          sys_id: EXISTING_SCRIPT_SYS_ID,
          script: 'function onLoad() { g_form.setValue("priority", "2"); }',
        },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_SCRIPT_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('maps ui_type label to numeric code in patchRecord body', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerCatalogClientScriptTools,
        mockClient,
      );
      try {
        await pair.mcpClient.callTool({
          name: 'update_catalog_client_script',
          arguments: { sys_id: EXISTING_SCRIPT_SYS_ID, ui_type: 'desktop' },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'catalog_script_client',
          EXISTING_SCRIPT_SYS_ID,
          expect.objectContaining({ ui_type: '0' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('triggers background script when cat_variable is updated', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerCatalogClientScriptTools,
        mockClient,
      );
      try {
        await pair.mcpClient.callTool({
          name: 'update_catalog_client_script',
          arguments: {
            sys_id: EXISTING_SCRIPT_SYS_ID,
            cat_variable: `IO:${VAR_SYS_ID}`,
          },
        });
        expect(
          mockClient.executeBackgroundScriptTrigger,
        ).toHaveBeenCalledOnce();
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_catalog_client_script',
        arguments: { sys_id: 'bad-id', active: true },
      });
      expect(result.isError).toBe(true);
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
      const pair = await buildTestPair(
        registerCatalogClientScriptTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_catalog_client_script',
          arguments: { sys_id: EXISTING_SCRIPT_SYS_ID, active: false },
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
