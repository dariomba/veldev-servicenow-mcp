import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerRecordProducerTools } from '../tools/record-producer.js';

const PRODUCER_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const FLOW_SYS_ID = '11112222333344445555666677778888';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: PRODUCER_SYS_ID, display_value: PRODUCER_SYS_ID },
      name: { value: 'Laptop Request', display_value: 'Laptop Request' },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceNowClient;
}

describe('record-producer tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerRecordProducerTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_record_producer', () => {
    it('creates the record producer and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_record_producer',
        arguments: { name: 'Laptop Request', table_name: 'sc_req_item' },
      });
      const text = firstText(result);
      expect(text).toContain('created successfully');
      expect(text).toContain(PRODUCER_SYS_ID);
      expect(text).toContain('Laptop Request');
      expect(result.isError).toBeFalsy();
    });

    it('calls createRecord on sc_cat_item_producer with defaults for active, order, redirect_url', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerRecordProducerTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_record_producer',
          arguments: { name: 'Laptop Request', table_name: 'sc_req_item' },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sc_cat_item_producer',
          expect.objectContaining({
            name: 'Laptop Request',
            table_name: 'sc_req_item',
            active: 'true',
            order: '100',
            redirect_url: 'generated_record',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('maps catalog_sys_id to sc_catalogs and category_sys_id to category in body', async () => {
      const CATALOG_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';
      const CATEGORY_SYS_ID = 'eeee5555ffff6666eeee5555ffff6666';
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerRecordProducerTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_record_producer',
          arguments: {
            name: 'Laptop Request',
            table_name: 'sc_req_item',
            catalog_sys_id: CATALOG_SYS_ID,
            category_sys_id: CATEGORY_SYS_ID,
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sc_cat_item_producer',
          expect.objectContaining({
            sc_catalogs: CATALOG_SYS_ID,
            category: CATEGORY_SYS_ID,
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('does not send script or post_insert_script when omitted', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerRecordProducerTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_record_producer',
          arguments: { name: 'Laptop Request', table_name: 'sc_req_item' },
        });
        const body = (mockClient.createRecord as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>;
        expect(body).not.toHaveProperty('script');
        expect(body).not.toHaveProperty('post_insert_script');
      } finally {
        await pair.teardown();
      }
    });

    it('sends script when provided', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerRecordProducerTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_record_producer',
          arguments: {
            name: 'Laptop Request',
            table_name: 'sc_req_item',
            script: 'current.priority = 1;',
            post_insert_script: 'current.update();',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sc_cat_item_producer',
          expect.objectContaining({
            script: 'current.priority = 1;',
            post_insert_script: 'current.update();',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when catalog_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_record_producer',
        arguments: {
          name: 'Laptop Request',
          table_name: 'sc_req_item',
          catalog_sys_id: 'not-valid',
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid sys_id');
    });

    it('returns isError when category_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_record_producer',
        arguments: {
          name: 'Laptop Request',
          table_name: 'sc_req_item',
          category_sys_id: 'Hardware',
        },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when both flow_designer_flow and workflow are provided', async () => {
      const result = await mcpClient.callTool({
        name: 'create_record_producer',
        arguments: {
          name: 'Laptop Request',
          table_name: 'sc_req_item',
          flow_designer_flow: FLOW_SYS_ID,
          workflow: FLOW_SYS_ID,
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
      const pair = await buildTestPair(
        registerRecordProducerTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_record_producer',
          arguments: { name: 'Laptop Request', table_name: 'sc_req_item' },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('403');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects empty name with Zod validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_record_producer',
        arguments: { name: '', table_name: 'sc_req_item' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('update_record_producer', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record_producer',
        arguments: {
          sys_id: PRODUCER_SYS_ID,
          name: 'Renamed Producer',
          active: false,
        },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(PRODUCER_SYS_ID);
      expect(text).toContain('name');
      expect(result.isError).toBeFalsy();
    });

    it('calls patchRecord on sc_cat_item_producer with correct boolean serialisation', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerRecordProducerTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_record_producer',
          arguments: {
            sys_id: PRODUCER_SYS_ID,
            active: false,
            no_save_as_draft: true,
            mandatory_attachment: true,
          },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sc_cat_item_producer',
          PRODUCER_SYS_ID,
          expect.objectContaining({
            active: 'false',
            no_save_as_draft: 'true',
            mandatory_attachment: 'true',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('reports "none" in updated fields when only sys_id is provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record_producer',
        arguments: { sys_id: PRODUCER_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('none');
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record_producer',
        arguments: { sys_id: 'not-a-valid-id', name: 'x' },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid');
    });

    it('returns isError when catalog_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record_producer',
        arguments: { sys_id: PRODUCER_SYS_ID, catalog_sys_id: 'bad-id' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when category_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record_producer',
        arguments: { sys_id: PRODUCER_SYS_ID, category_sys_id: 'bad-id' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when both flow_designer_flow and workflow are provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record_producer',
        arguments: {
          sys_id: PRODUCER_SYS_ID,
          flow_designer_flow: FLOW_SYS_ID,
          workflow: FLOW_SYS_ID,
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not both');
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
        registerRecordProducerTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_record_producer',
          arguments: { sys_id: PRODUCER_SYS_ID, name: 'New Name' },
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
