import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerUpdateSetTools } from '../tools/update-sets.js';

const UPDATE_SET_SYS_ID = 'aabb1122ccdd3344aabb1122ccdd3344';
const UPDATE_SET_NAME = 'My Feature Update Set';
const APPLICATION_NAME = 'Global';
const APPLICATION_SYS_ID = 'a000000000000000000000000000001a';

function buildMockClient(): ServiceNowClient {
  return {
    getUsername: vi.fn().mockReturnValue('admin'),
    listRecords: vi.fn().mockResolvedValue([
      {
        value: { value: UPDATE_SET_SYS_ID, display_value: UPDATE_SET_SYS_ID },
      },
    ]),
    getRecord: vi.fn().mockResolvedValue({
      name: { value: UPDATE_SET_NAME, display_value: UPDATE_SET_NAME },
      application: {
        value: APPLICATION_SYS_ID,
        display_value: APPLICATION_NAME,
      },
    }),
  } as unknown as ServiceNowClient;
}

describe('update-set tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerUpdateSetTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('get_current_update_set', () => {
    it('returns the update set name and application', async () => {
      const result = await mcpClient.callTool({
        name: 'get_current_update_set',
        arguments: {},
      });
      const text = firstText(result);
      expect(text).toContain(UPDATE_SET_NAME);
      expect(text).toContain(APPLICATION_NAME);
      expect(text).toContain(APPLICATION_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('returns a not-found message when no user preference exists', async () => {
      const noPrefsClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, noPrefsClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'get_current_update_set',
          arguments: {},
        });
        const text = firstText(result);
        expect(text).toContain('No active Update Set');
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
              403,
              'Forbidden',
              'ACL restriction',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'get_current_update_set',
          arguments: {},
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
