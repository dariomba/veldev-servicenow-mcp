import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerTableCrudTools } from './table-crud.js';

const TABLE = 'incident';
const SYS_ID = 'a1111111111111111111111111111111';

const RECORD = {
  sys_id: { value: SYS_ID, display_value: SYS_ID },
  number: { value: 'INC0010001', display_value: 'INC0010001' },
  short_description: { value: 'Test incident', display_value: 'Test incident' },
  state: { value: '1', display_value: 'New' },
  assigned_to: {
    value: 'abc123def456abc123def456abc12345',
    display_value: 'John Doe',
  },
};

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([RECORD]),
    getRecord: vi.fn().mockResolvedValue(RECORD),
    createRecord: vi.fn().mockResolvedValue(RECORD),
    updateRecord: vi.fn().mockResolvedValue(RECORD),
    patchRecord: vi.fn().mockResolvedValue(RECORD),
  } as unknown as ServiceNowClient;
}

describe('table-crud tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let mockClient: ServiceNowClient;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    mockClient = buildMockClient();
    const pair = await buildTestPair(registerTableCrudTools, mockClient);
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('query_records', () => {
    it('returns a single block containing JSON', async () => {
      const result = await mcpClient.callTool({
        name: 'query_records',
        arguments: { table: TABLE, limit: 5 },
      });
      const r = result as { content: Array<unknown> };
      expect(r.content).toHaveLength(1);
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(firstText(result));
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('passes encoded query and limit to client', async () => {
      await mcpClient.callTool({
        name: 'query_records',
        arguments: { table: TABLE, query: 'state=1^priority=2', limit: 3 },
      });
      expect(mockClient.listRecords).toHaveBeenCalledWith(
        TABLE,
        'state=1^priority=2',
        undefined,
        3,
        undefined,
      );
    });

    it('passes offset to client when provided', async () => {
      await mcpClient.callTool({
        name: 'query_records',
        arguments: { table: TABLE, limit: 10, offset: 20 },
      });
      expect(mockClient.listRecords).toHaveBeenCalledWith(
        TABLE,
        '',
        undefined,
        10,
        20,
      );
    });

    it('handles empty results — returns an empty JSON array', async () => {
      const emptyClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerTableCrudTools, emptyClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'query_records',
          arguments: { table: TABLE },
        });
        expect((result as { content: Array<unknown> }).content).toHaveLength(1);
        expect(JSON.parse(firstText(result))).toEqual([]);
      } finally {
        await pair.teardown();
      }
    });

    it('raw JSON preserves SnReference objects intact', async () => {
      const result = await mcpClient.callTool({
        name: 'query_records',
        arguments: { table: TABLE },
      });
      const json = JSON.parse(firstText(result));
      expect(json[0].assigned_to).toEqual({
        value: 'abc123def456abc123def456abc12345',
        display_value: 'John Doe',
      });
    });
  });

  describe('get_record', () => {
    it('returns a single block containing JSON', async () => {
      const result = await mcpClient.callTool({
        name: 'get_record',
        arguments: { table: TABLE, sys_id: SYS_ID },
      });
      expect((result as { content: Array<unknown> }).content).toHaveLength(1);
      expect(result.isError).toBeFalsy();
      JSON.parse(firstText(result)); // must be valid JSON
    });

    it('passes fields correctly to client', async () => {
      await mcpClient.callTool({
        name: 'get_record',
        arguments: {
          table: TABLE,
          sys_id: SYS_ID,
          fields: ['sys_id', 'state'],
        },
      });
      expect(mockClient.getRecord).toHaveBeenCalledWith(TABLE, SYS_ID, [
        'sys_id',
        'state',
      ]);
    });
  });

  describe('create_record', () => {
    it('returns a single block containing sys_id, table name, and number', async () => {
      const result = await mcpClient.callTool({
        name: 'create_record',
        arguments: { table: TABLE, data: { short_description: 'Test' } },
      });
      expect((result as { content: Array<unknown> }).content).toHaveLength(1);
      expect(firstText(result)).toContain(TABLE);
      expect(firstText(result)).toContain(SYS_ID);
      expect(firstText(result)).toContain('INC0010001');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('update_record', () => {
    it('calls updateRecord (PUT) when patch=false', async () => {
      await mcpClient.callTool({
        name: 'update_record',
        arguments: {
          table: TABLE,
          sys_id: SYS_ID,
          data: { state: '2' },
          patch: false,
        },
      });
      expect(mockClient.updateRecord).toHaveBeenCalledWith(TABLE, SYS_ID, {
        state: '2',
      });
      expect(mockClient.patchRecord).not.toHaveBeenCalled();
    });

    it('calls patchRecord (PATCH) when patch=true', async () => {
      await mcpClient.callTool({
        name: 'update_record',
        arguments: {
          table: TABLE,
          sys_id: SYS_ID,
          data: { state: '2' },
          patch: true,
        },
      });
      expect(mockClient.patchRecord).toHaveBeenCalledWith(TABLE, SYS_ID, {
        state: '2',
      });
      expect(mockClient.updateRecord).not.toHaveBeenCalled();
    });

    it('defaults to PATCH when patch is omitted', async () => {
      const result = await mcpClient.callTool({
        name: 'update_record',
        arguments: { table: TABLE, sys_id: SYS_ID, data: { state: '2' } },
      });
      expect(mockClient.patchRecord).toHaveBeenCalledWith(TABLE, SYS_ID, {
        state: '2',
      });
      expect(mockClient.updateRecord).not.toHaveBeenCalled();
      expect((result as { content: Array<unknown> }).content).toHaveLength(1);
      expect(result.isError).toBeFalsy();
    });
  });

  describe('error handling', () => {
    it('returns isError=true with status code when client throws SnApiError', async () => {
      const errorClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              500,
              'Internal Server Error',
              'Database error',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerTableCrudTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'query_records',
          arguments: { table: TABLE },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError=true when get_record throws', async () => {
      const errorClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockRejectedValue(new Error('record not found')),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerTableCrudTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'get_record',
          arguments: { table: TABLE, sys_id: SYS_ID },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('record not found');
      } finally {
        await pair.teardown();
      }
    });
  });
});
