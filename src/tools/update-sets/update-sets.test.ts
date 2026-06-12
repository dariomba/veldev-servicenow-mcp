import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerUpdateSetTools } from './update-sets.js';

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

  describe('list_update_sets', () => {
    it('returns a summary block and a JSON block, defaulting to in progress', async () => {
      const listClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: UPDATE_SET_SYS_ID,
              display_value: UPDATE_SET_SYS_ID,
            },
            name: { value: UPDATE_SET_NAME, display_value: UPDATE_SET_NAME },
            state: { value: 'in progress', display_value: 'In progress' },
            application: {
              value: APPLICATION_SYS_ID,
              display_value: APPLICATION_NAME,
            },
            is_default: { value: 'false', display_value: 'false' },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, listClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_update_sets',
          arguments: {},
        });
        const content = (result as { content: Array<{ text: string }> })
          .content;
        expect(content).toHaveLength(2);
        expect(content[0].text).toContain(UPDATE_SET_NAME);
        expect(content[0].text).toContain('In progress');
        expect(content[1].text).toContain(UPDATE_SET_SYS_ID);

        const query = (listClient.listRecords as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as string;
        expect(query).toContain('state=in progress');
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('builds the query from state, application and name filters', async () => {
      const listClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, listClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_update_sets',
          arguments: {
            state: 'complete',
            application: 'global',
            name_contains: 'Feature',
          },
        });
        const query = (listClient.listRecords as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as string;
        expect(query).toContain('state=complete');
        expect(query).toContain('application=global');
        expect(query).toContain('nameLIKEFeature');
        expect(firstText(result)).toContain('No update sets match');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('create_update_set', () => {
    it('creates a set defaulting to the global scope', async () => {
      const createClient = {
        ...buildMockClient(),
        createRecord: vi.fn().mockResolvedValue({
          sys_id: {
            value: UPDATE_SET_SYS_ID,
            display_value: UPDATE_SET_SYS_ID,
          },
        }),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, createClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_update_set',
          arguments: { name: UPDATE_SET_NAME },
        });
        const text = firstText(result);
        expect(text).toContain('created successfully');
        expect(text).toContain(UPDATE_SET_SYS_ID);
        // Defaults to NOT current, and always carries the UI-picker reminder.
        expect(text).toContain('Not set as current');
        expect(text).toContain('single source of truth');

        const [table, body] = (
          createClient.createRecord as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        expect(table).toBe('sys_update_set');
        expect(body).toMatchObject({
          name: UPDATE_SET_NAME,
          application: 'global',
        });
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('sets the new set as current when set_as_current=true', async () => {
      const createClient = {
        ...buildMockClient(),
        createRecord: vi.fn().mockResolvedValue({
          sys_id: {
            value: UPDATE_SET_SYS_ID,
            display_value: UPDATE_SET_SYS_ID,
          },
        }),
        listRecords: vi
          .fn()
          .mockResolvedValue([
            { sys_id: { value: 'pref0000000000000000000000000001' } },
          ]),
        patchRecord: vi.fn().mockResolvedValue({}),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, createClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_update_set',
          arguments: { name: UPDATE_SET_NAME, set_as_current: true },
        });
        expect(firstText(result)).toContain('now your active update set');
        expect(createClient.patchRecord).toHaveBeenCalledWith(
          'sys_user_preference',
          'pref0000000000000000000000000001',
          { value: UPDATE_SET_SYS_ID },
        );
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('set_current_update_set', () => {
    it('patches the existing preference when given a sys_id', async () => {
      const setClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          name: { value: UPDATE_SET_NAME, display_value: UPDATE_SET_NAME },
        }),
        listRecords: vi
          .fn()
          .mockResolvedValue([
            { sys_id: { value: 'pref0000000000000000000000000001' } },
          ]),
        patchRecord: vi.fn().mockResolvedValue({}),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, setClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'set_current_update_set',
          arguments: { update_set: UPDATE_SET_SYS_ID },
        });
        const text = firstText(result);
        expect(text).toContain('Active update set changed');
        expect(text).toContain('single source of truth');
        expect(setClient.patchRecord).toHaveBeenCalledWith(
          'sys_user_preference',
          'pref0000000000000000000000000001',
          { value: UPDATE_SET_SYS_ID },
        );
      } finally {
        await pair.teardown();
      }
    });

    it('also sets the preference for ui_username when it differs from the api user', async () => {
      const setClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          name: { value: UPDATE_SET_NAME, display_value: UPDATE_SET_NAME },
        }),
        // No existing preference rows → the tool falls back to resolving the
        // user and creating a preference for each of the two users.
        listRecords: vi
          .fn()
          .mockResolvedValueOnce([]) // api user preference lookup
          .mockResolvedValueOnce([
            { sys_id: { value: 'user000000000000000000000000api1' } },
          ]) // api user sys_user lookup
          .mockResolvedValueOnce([]) // ui user preference lookup
          .mockResolvedValueOnce([
            { sys_id: { value: 'user00000000000000000000000human1' } },
          ]), // ui user sys_user lookup
        createRecord: vi.fn().mockResolvedValue({}),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, setClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'set_current_update_set',
          arguments: { update_set: UPDATE_SET_SYS_ID, ui_username: 'jane.doe' },
        });
        const text = firstText(result);
        expect(text).toContain('Active update set changed');
        expect(text).toContain('jane.doe');
        // One preference created per user (api user + ui user).
        expect(setClient.createRecord).toHaveBeenCalledTimes(2);
        expect(setClient.createRecord).toHaveBeenCalledWith(
          'sys_user_preference',
          expect.objectContaining({
            value: UPDATE_SET_SYS_ID,
            user: 'user00000000000000000000000human1',
          }),
        );
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('does not duplicate work when ui_username equals the api user', async () => {
      const setClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          name: { value: UPDATE_SET_NAME, display_value: UPDATE_SET_NAME },
        }),
        listRecords: vi
          .fn()
          .mockResolvedValue([
            { sys_id: { value: 'pref0000000000000000000000000001' } },
          ]),
        patchRecord: vi.fn().mockResolvedValue({}),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, setClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'set_current_update_set',
          arguments: { update_set: UPDATE_SET_SYS_ID, ui_username: 'admin' },
        });
        // admin is the mocked api user → only the single patch, no extra work.
        expect(setClient.patchRecord).toHaveBeenCalledTimes(1);
        expect(firstText(result)).not.toContain('Also set as current for UI');
      } finally {
        await pair.teardown();
      }
    });

    it('resolves a name to a sys_id and errors on multiple matches', async () => {
      const setClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: { value: UPDATE_SET_SYS_ID },
            name: { value: UPDATE_SET_NAME },
          },
          {
            sys_id: { value: 'b000000000000000000000000000000b' },
            name: { value: UPDATE_SET_NAME },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUpdateSetTools, setClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'set_current_update_set',
          arguments: { update_set: UPDATE_SET_NAME },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('Multiple update sets');
      } finally {
        await pair.teardown();
      }
    });
  });
});
