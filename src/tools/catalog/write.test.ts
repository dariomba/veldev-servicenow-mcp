import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerCatalogWriteTools } from './write.js';

const ITEM_SYS_ID = '7bad3ce593700310eb4cf83bdd03d69d';
const NEW_ITEM_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const VARSET_SYS_ID = '04edebd49324c310eb4cf83bdd03d6dd';
const JUNCTION_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';
const VAR_SYS_ID = 'eeee5555ffff6666eeee5555ffff6666';
const NEW_VAR_SYS_ID = 'aaaa9999bbbb8888aaaa9999bbbb8888';
const CRITERIA_SYS_ID = 'dddd1111eeee2222dddd1111eeee2222';
const CATEGORY_SYS_ID = 'abcd1234abcd5678abcd1234abcd5678';
const CATALOG_SYS_ID = 'efab1234efab5678efab1234efab5678';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockImplementation((table: string) => {
      if (table === 'sc_cat_item') {
        return Promise.resolve({
          sys_id: { value: NEW_ITEM_SYS_ID, display_value: NEW_ITEM_SYS_ID },
          name: { value: 'Test Item', display_value: 'Test Item' },
        });
      }
      if (table === 'io_set_item') {
        return Promise.resolve({
          sys_id: { value: JUNCTION_SYS_ID, display_value: JUNCTION_SYS_ID },
        });
      }
      if (table === 'item_option_new') {
        return Promise.resolve({
          sys_id: { value: NEW_VAR_SYS_ID, display_value: NEW_VAR_SYS_ID },
        });
      }
      return Promise.resolve({
        sys_id: {
          value: 'ffff0000ffff0000ffff0000ffff0000',
          display_value: 'ffff0000ffff0000ffff0000ffff0000',
        },
      });
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceNowClient;
}

describe('catalog-write tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerCatalogWriteTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_catalog_item', () => {
    it('creates the item and returns sys_id with confirmation', async () => {
      const result = await mcpClient.callTool({
        name: 'create_catalog_item',
        arguments: { name: 'IT Equipment Request' },
      });
      const text = firstText(result);
      expect(text).toContain('created successfully');
      expect(text).toContain(NEW_ITEM_SYS_ID);
      expect(text).toContain('IT Equipment Request');
      expect(result.isError).toBeFalsy();
    });

    it('calls createRecord with name, active and order as strings', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_catalog_item',
          arguments: { name: 'My Item', category_sys_id: CATEGORY_SYS_ID },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sc_cat_item',
          expect.objectContaining({
            name: 'My Item',
            active: 'true',
            order: '100',
            category: CATEGORY_SYS_ID,
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when catalog_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_catalog_item',
        arguments: { name: 'My Item', catalog_sys_id: 'not-valid' },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid sys_id');
    });

    it('returns isError when category_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_catalog_item',
        arguments: { name: 'My Item', category_sys_id: 'Hardware' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when both flow_designer_flow and workflow are provided', async () => {
      const result = await mcpClient.callTool({
        name: 'create_catalog_item',
        arguments: {
          name: 'My Item',
          flow_designer_flow: CATALOG_SYS_ID,
          workflow: CATALOG_SYS_ID,
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not both');
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
      const pair = await buildTestPair(registerCatalogWriteTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_catalog_item',
          arguments: { name: 'My Item' },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('associate_variable_set', () => {
    it('creates the io_set_item junction and returns sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'associate_variable_set',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          variable_set_sys_id: VARSET_SYS_ID,
        },
      });
      const text = firstText(result);
      expect(text).toContain('associated successfully');
      expect(text).toContain(JUNCTION_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('returns existing junction without creating when already associated', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: JUNCTION_SYS_ID,
              display_value: JUNCTION_SYS_ID,
            },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerCatalogWriteTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'associate_variable_set',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            variable_set_sys_id: VARSET_SYS_ID,
          },
        });
        const text = firstText(result);
        expect(text).toContain('already associated');
        expect(text).toContain(JUNCTION_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when catalog_item_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'associate_variable_set',
        arguments: {
          catalog_item_sys_id: 'bad-id',
          variable_set_sys_id: VARSET_SYS_ID,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when variable_set_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'associate_variable_set',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          variable_set_sys_id: 'bad-id',
        },
      });
      expect(result.isError).toBe(true);
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              500,
              'Internal Server Error',
              'error',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerCatalogWriteTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'associate_variable_set',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            variable_set_sys_id: VARSET_SYS_ID,
          },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('batch_create_catalog_variables', () => {
    it('creates variables and returns sys_ids in summary', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_catalog_variables',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          variables: [
            {
              name: 'requested_for',
              question_text: 'Requested for',
              type: '8',
              reference_table: 'sys_user',
            },
          ],
        },
      });
      const text = firstText(result);
      expect(text).toContain('Created: 1');
      expect(text).toContain(NEW_VAR_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('calls createRecord with mandatory and hidden as boolean strings', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'batch_create_catalog_variables',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            variables: [
              {
                name: 'priority',
                question_text: 'Priority',
                type: '6',
                mandatory: true,
              },
            ],
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'item_option_new',
          expect.objectContaining({
            name: 'priority',
            cat_item: ITEM_SYS_ID,
            type: '6',
            mandatory: 'true',
            hidden: 'false',
            active: 'true',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('creates question_choice records for variables with choices', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'batch_create_catalog_variables',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            variables: [
              {
                name: 'device_type',
                question_text: 'Device Type',
                type: '5',
                choices: [
                  { text: 'Laptop', value: 'laptop' },
                  { text: 'Desktop', value: 'desktop' },
                ],
              },
            ],
          },
        });
        const choiceCalls = (
          mockClient.createRecord as ReturnType<typeof vi.fn>
        ).mock.calls.filter((args: unknown[]) => args[0] === 'question_choice');
        expect(choiceCalls).toHaveLength(2);
      } finally {
        await pair.teardown();
      }
    });

    it('skips existing variables and reports them in summary', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: { value: VAR_SYS_ID, display_value: VAR_SYS_ID },
            name: { value: 'priority', display_value: 'priority' },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerCatalogWriteTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_catalog_variables',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            variables: [
              { name: 'priority', question_text: 'Priority', type: '6' },
            ],
          },
        });
        const text = firstText(result);
        expect(text).toContain('Skipped');
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when catalog_item_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_catalog_variables',
        arguments: {
          catalog_item_sys_id: 'bad-id',
          variables: [{ name: 'x', question_text: 'X', type: '6' }],
        },
      });
      expect(result.isError).toBe(true);
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
      const pair = await buildTestPair(registerCatalogWriteTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_catalog_variables',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            variables: [{ name: 'x', question_text: 'X', type: '6' }],
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

  describe('update_catalog_item', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_catalog_item',
        arguments: { sys_id: ITEM_SYS_ID, name: 'Renamed Item', active: false },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(ITEM_SYS_ID);
      expect(text).toContain('name');
      expect(result.isError).toBeFalsy();
    });

    it('serialises active as string in patchRecord body', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_catalog_item',
          arguments: { sys_id: ITEM_SYS_ID, active: false },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sc_cat_item',
          ITEM_SYS_ID,
          expect.objectContaining({ active: 'false' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_catalog_item',
        arguments: { sys_id: 'bad-id', name: 'x' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when catalog_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_catalog_item',
        arguments: { sys_id: ITEM_SYS_ID, catalog_sys_id: 'bad-id' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when both flow_designer_flow and workflow are provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_catalog_item',
        arguments: {
          sys_id: ITEM_SYS_ID,
          flow_designer_flow: CATALOG_SYS_ID,
          workflow: CATALOG_SYS_ID,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        patchRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(404, 'Not Found', 'missing', 'https://example.com'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerCatalogWriteTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_catalog_item',
          arguments: { sys_id: ITEM_SYS_ID, name: 'x' },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('404');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('batch_update_catalog_variables', () => {
    it('patches variables and returns summary', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_update_catalog_variables',
        arguments: {
          variables: [
            {
              sys_id: VAR_SYS_ID,
              question_text: 'Updated label',
              mandatory: true,
            },
          ],
        },
      });
      const text = firstText(result);
      expect(text).toContain('Batch variable update complete');
      expect(text).toContain(VAR_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('patches existing choices and creates new ones', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        const CHOICE_SYS_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
        await pair.mcpClient.callTool({
          name: 'batch_update_catalog_variables',
          arguments: {
            variables: [
              {
                sys_id: VAR_SYS_ID,
                choices: [
                  { sys_id: CHOICE_SYS_ID, text: 'Updated', value: 'updated' },
                  { text: 'New Option', value: 'new_option' },
                ],
              },
            ],
          },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'question_choice',
          CHOICE_SYS_ID,
          expect.objectContaining({ text: 'Updated', value: 'updated' }),
        );
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'question_choice',
          expect.objectContaining({
            text: 'New Option',
            value: 'new_option',
            question: VAR_SYS_ID,
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when a variable sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_update_catalog_variables',
        arguments: {
          variables: [{ sys_id: 'bad-id', question_text: 'x' }],
        },
      });
      expect(result.isError).toBe(true);
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        patchRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(404, 'Not Found', 'missing', 'https://example.com'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerCatalogWriteTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_update_catalog_variables',
          arguments: {
            variables: [{ sys_id: VAR_SYS_ID, question_text: 'x' }],
          },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('404');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('attach_user_criteria', () => {
    it('creates junction in available_for table and returns sys_id', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'attach_user_criteria',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            user_criteria_sys_id: CRITERIA_SYS_ID,
            restriction_type: 'available_for',
          },
        });
        const text = firstText(result);
        expect(text).toContain('attached successfully');
        expect(text).toContain('Available For');
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sc_cat_item_user_criteria_mtom',
          expect.objectContaining({
            sc_cat_item: ITEM_SYS_ID,
            user_criteria: CRITERIA_SYS_ID,
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('creates junction in not_available_for table when restriction_type is not_available_for', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerCatalogWriteTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'attach_user_criteria',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            user_criteria_sys_id: CRITERIA_SYS_ID,
            restriction_type: 'not_available_for',
          },
        });
        const text = firstText(result);
        expect(text).toContain('Not Available For');
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sc_cat_item_user_criteria_no_mtom',
          expect.any(Object),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when catalog_item_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'attach_user_criteria',
        arguments: {
          catalog_item_sys_id: 'bad-id',
          user_criteria_sys_id: CRITERIA_SYS_ID,
          restriction_type: 'available_for',
        },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when user_criteria_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'attach_user_criteria',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          user_criteria_sys_id: 'bad-id',
          restriction_type: 'available_for',
        },
      });
      expect(result.isError).toBe(true);
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
      const pair = await buildTestPair(registerCatalogWriteTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'attach_user_criteria',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            user_criteria_sys_id: CRITERIA_SYS_ID,
            restriction_type: 'available_for',
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
});
