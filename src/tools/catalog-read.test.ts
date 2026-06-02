import { createRequire } from 'node:module';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerCatalogReadTools } from '../tools/catalog-read.js';

const require = createRequire(import.meta.url);
const catalogItem = require('../tests/fixtures/sc_cat_item.json') as Record<
  string,
  unknown
>;
const variables = require('../tests/fixtures/variables.json') as unknown[];
const uiPolicies = require('../tests/fixtures/ui_policies.json') as unknown[];
const clientScripts =
  require('../tests/fixtures/client_scripts.json') as unknown[];
const variableSets =
  require('../tests/fixtures/variable_sets.json') as unknown[];

const ITEM_SYS_ID = '7bad3ce593700310eb4cf83bdd03d69d';
const ITEM_NAME = 'IT Request';
const SCRIPT_SYS_ID = '0148f31c93010310eb4cf83bdd03d6ee';
const VARSET_SYS_ID = '04edebd49324c310eb4cf83bdd03d6dd';
const VARSET_NAME = 'Prueba variable set';

function buildMockClient(overrides?: {
  listRecords?: (table: string, query: string) => unknown[] | null;
  getRecord?: (table: string, sysId: string) => unknown | null;
}): ServiceNowClient {
  const mockGetRecord = vi
    .fn()
    .mockImplementation((table: string, sysId: string) => {
      const override = overrides?.getRecord?.(table, sysId);
      if (override !== null && override !== undefined)
        return Promise.resolve(override);
      if (table === 'sc_cat_item') return Promise.resolve(catalogItem);
      return Promise.reject(
        new Error(`Unexpected getRecord(${table}, ${sysId})`),
      );
    });

  const mockListRecords = vi
    .fn()
    .mockImplementation((table: string, query: string) => {
      const override = overrides?.listRecords?.(table, query);
      if (override !== null && override !== undefined)
        return Promise.resolve(override);
      switch (table) {
        case 'item_option_new':
          return Promise.resolve(variables);
        case 'catalog_ui_policy':
          return Promise.resolve(uiPolicies);
        case 'catalog_ui_policy_action':
          return Promise.resolve([]);
        case 'catalog_script_client':
          return Promise.resolve(clientScripts);
        case 'sc_cat_item_user_criteria_mtom':
          return Promise.resolve([]);
        case 'io_set_item':
          return Promise.resolve(variableSets);
        case 'question_choice':
          return Promise.resolve([]);
        case 'sc_cat_item':
          return Promise.resolve([catalogItem]);
        case 'sc_catalog':
          return Promise.resolve([
            {
              sys_id: { value: 'cat001', display_value: 'cat001' },
              title: {
                value: 'Service Catalog',
                display_value: 'Service Catalog',
              },
              description: { value: '', display_value: '' },
            },
          ]);
        case 'sc_category':
          return Promise.resolve([
            {
              sys_id: { value: 'categ001', display_value: 'categ001' },
              title: { value: 'Hardware', display_value: 'Hardware' },
              description: { value: '', display_value: '' },
              parent: { value: '', display_value: '' },
              active: { value: 'true', display_value: 'true' },
            },
          ]);
        default:
          return Promise.resolve([]);
      }
    });

  const mockResolveSysId = vi
    .fn()
    .mockImplementation((idOrName: string) =>
      Promise.resolve(idOrName === ITEM_NAME ? ITEM_SYS_ID : idOrName),
    );

  return {
    getRecord: mockGetRecord,
    listRecords: mockListRecords,
    resolveCatalogItemSysId: mockResolveSysId,
    getUsername: vi.fn().mockReturnValue('admin'),
  } as unknown as ServiceNowClient;
}

describe('catalog read tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerCatalogReadTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('list_catalog_items', () => {
    it('returns a text block listing the catalog item name', async () => {
      const result = await mcpClient.callTool({
        name: 'list_catalog_items',
        arguments: {},
      });
      const text = firstText(result);
      expect(text).toContain(ITEM_NAME);
    });

    it('sys_id in output is a plain hex string, not an object', async () => {
      const result = await mcpClient.callTool({
        name: 'list_catalog_items',
        arguments: {},
      });
      const text = firstText(result);
      expect(text).toContain(`sys_id: ${ITEM_SYS_ID}`);
      expect(text).not.toContain('"display_value"');
      expect(text).not.toContain('"value"');
    });

    it('filters by category_sys_id when provided', async () => {
      const result = await mcpClient.callTool({
        name: 'list_catalog_items',
        arguments: { category_sys_id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' },
      });
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when category_sys_id is not a valid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'list_catalog_items',
        arguments: { category_sys_id: 'Hardware' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid sys_id');
    });

    it('returns isError when client throws SnApiError', async () => {
      const errorClient = buildMockClient({
        listRecords: (table) => {
          if (table === 'sc_cat_item')
            throw new SnApiError(
              403,
              'Forbidden',
              'ACL restriction',
              'https://example.com/api',
            );
          return null;
        },
      });
      const pair = await buildTestPair(registerCatalogReadTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_catalog_items',
          arguments: {},
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('get_catalog_item_definition', () => {
    it('returns a text summary containing the item name', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      expect(firstText(result)).toContain(ITEM_NAME);
    });

    it('summary contains a plain-string sys_id (regression: was SnReference object)', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain(`sys_id: ${ITEM_SYS_ID}`);
      expect(text).not.toContain('"display_value"');
      expect(text).not.toContain('"value"');
    });

    it('summary lists variable names', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('requested_for');
      expect(text).toContain('priority');
    });

    it('variable sys_ids are plain strings, not SnReference objects', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toMatch(/sys_id: [0-9a-f]{32}/);
      expect(text).not.toContain('"display_value"');
    });

    it('summary lists client script names and their sys_ids', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('Set Default Priority to Medium');
      expect(text).toContain(SCRIPT_SYS_ID);
    });

    it('client script sys_id is a plain string', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain(SCRIPT_SYS_ID);
      expect(text).not.toContain(`{`);
    });

    it('summary lists the variable set name and sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain(VARSET_NAME);
      expect(text).toContain(VARSET_SYS_ID);
    });

    it('summary includes UI policy names', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('Show Please Specify when Request Type is Other');
    });

    it('active flag renders as a plain boolean string', async () => {
      const result = await mcpClient.callTool({
        name: 'get_catalog_item_definition',
        arguments: { id_or_name: ITEM_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('Active: true');
    });

    it('returns isError when client throws SnApiError', async () => {
      const throwingClient = {
        ...buildMockClient(),
        resolveCatalogItemSysId: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              500,
              'Internal Server Error',
              'server fault',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;

      const pair = await buildTestPair(
        registerCatalogReadTools,
        throwingClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'get_catalog_item_definition',
          arguments: { id_or_name: ITEM_SYS_ID },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('list_catalog_categories', () => {
    it('returns a text block listing category names and sys_ids', async () => {
      const result = await mcpClient.callTool({
        name: 'list_catalog_categories',
        arguments: { search: 'Hardware' },
      });
      const text = firstText(result);
      expect(text).toContain('Hardware');
      expect(text).toContain('categ001');
    });

    it('returns not-found message when no categories match', async () => {
      const emptyClient = buildMockClient({
        listRecords: (table) => (table === 'sc_category' ? [] : null),
      });
      const pair = await buildTestPair(registerCatalogReadTools, emptyClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_catalog_categories',
          arguments: { search: 'Nonexistent' },
        });
        const text = firstText(result);
        expect(text).toContain('No categories found');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('list_catalogs', () => {
    it('returns catalog title and sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'list_catalogs',
        arguments: {},
      });
      const text = firstText(result);
      expect(text).toContain('Service Catalog');
      expect(text).toContain('cat001');
    });
  });
});
