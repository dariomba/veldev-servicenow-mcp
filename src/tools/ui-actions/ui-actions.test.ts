import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerUiActionTools } from './ui-actions.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'dddd3333eeee4444dddd3333eeee4444';

function ref(value: string) {
  return { value, display_value: value };
}

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn().mockResolvedValue({ sys_id: ref(EXISTING_SYS_ID) }),
    getInstanceUrl: vi.fn().mockReturnValue('https://pdi.example.com'),
  } as unknown as ServiceNowClient;
}

describe('ui-action tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;
  let mockClient: ServiceNowClient;

  beforeEach(async () => {
    mockClient = buildMockClient();
    const pair = await buildTestPair(registerUiActionTools, mockClient);
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_ui_action', () => {
    it('creates a classic form button and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_ui_action',
        arguments: {
          name: 'Resolve',
          table: 'incident',
          form_button: true,
          script: 'current.state = 6; current.update();',
        },
      });
      const text = firstText(result);
      expect(text).toContain('UI Action created');
      expect(text).toContain(NEW_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('serialises booleans and order to strings', async () => {
      await mcpClient.callTool({
        name: 'create_ui_action',
        arguments: {
          name: 'My Action',
          table: 'incident',
          form_button: true,
          client: true,
          onclick: 'doIt()',
        },
      });
      expect(mockClient.createRecord).toHaveBeenCalledWith(
        'sys_ui_action',
        expect.objectContaining({
          name: 'My Action',
          table: 'incident',
          active: 'true',
          order: '100',
          client: 'true',
          form_button: 'true',
          onclick: 'doIt()',
        }),
      );
      // Toggle left unspecified (no workspace field) → not sent at all.
      const body = (mockClient.createRecord as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(body).not.toHaveProperty('format_for_configurable_workspace');
    });

    it('auto-enables format_for_configurable_workspace when a workspace field is set', async () => {
      const result = await mcpClient.callTool({
        name: 'create_ui_action',
        arguments: {
          name: 'WS Button',
          table: 'incident',
          form_button_v2: true,
          client_script_v2: 'function onClick(g_form) {}',
        },
      });
      expect(mockClient.createRecord).toHaveBeenCalledWith(
        'sys_ui_action',
        expect.objectContaining({
          form_button_v2: 'true',
          format_for_configurable_workspace: 'true',
        }),
      );
      const text = firstText(result);
      expect(text).toContain('auto-enabled');
      expect(text).toContain('workspace: enabled');
    });

    it('warns when no placement flag is set', async () => {
      const result = await mcpClient.callTool({
        name: 'create_ui_action',
        arguments: {
          name: 'Orphan',
          table: 'incident',
          script: 'gs.info("hi");',
        },
      });
      expect(firstText(result)).toContain('no placement flag set');
    });

    it('returns existing record without creating when name+table exists', async () => {
      const idempotent = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiActionTools, idempotent);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_ui_action',
          arguments: { name: 'Resolve', table: 'incident', form_button: true },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(idempotent.createRecord).not.toHaveBeenCalled();
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
            new SnApiError(500, 'Internal Server Error', 'fault', 'https://x'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiActionTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_ui_action',
          arguments: { name: 'X', table: 'incident', form_button: true },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects empty name with a validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_ui_action',
        arguments: { name: '', table: 'incident' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('update_ui_action', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_action',
        arguments: { sys_id: EXISTING_SYS_ID, name: 'Renamed', active: false },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(mockClient.patchRecord).toHaveBeenCalledWith(
        'sys_ui_action',
        EXISTING_SYS_ID,
        expect.objectContaining({ name: 'Renamed', active: 'false' }),
      );
    });

    it('auto-enables workspace toggle on update when a workspace field is set', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_action',
        arguments: { sys_id: EXISTING_SYS_ID, form_menu_button_v2: true },
      });
      expect(mockClient.patchRecord).toHaveBeenCalledWith(
        'sys_ui_action',
        EXISTING_SYS_ID,
        expect.objectContaining({
          form_menu_button_v2: 'true',
          format_for_configurable_workspace: 'true',
        }),
      );
      expect(firstText(result)).toContain('auto-enabled');
    });

    it('does not auto-enable when workspace toggle is explicitly false', async () => {
      await mcpClient.callTool({
        name: 'update_ui_action',
        arguments: {
          sys_id: EXISTING_SYS_ID,
          form_button_v2: true,
          format_for_configurable_workspace: false,
        },
      });
      expect(mockClient.patchRecord).toHaveBeenCalledWith(
        'sys_ui_action',
        EXISTING_SYS_ID,
        expect.objectContaining({
          form_button_v2: 'true',
          format_for_configurable_workspace: 'false',
        }),
      );
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_action',
        arguments: { sys_id: 'not-valid', name: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('returns no-op when no fields besides sys_id are provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_action',
        arguments: { sys_id: EXISTING_SYS_ID },
      });
      expect(firstText(result)).toContain('No fields to update');
    });
  });

  describe('list_ui_actions', () => {
    it('summarises matched actions with flags', async () => {
      const listClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: ref(NEW_SYS_ID),
            name: ref('Resolve'),
            table: ref('incident'),
            active: ref('true'),
            order: ref('100'),
            client: ref('true'),
            format_for_configurable_workspace: ref('true'),
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiActionTools, listClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_ui_actions',
          arguments: { table: 'incident' },
        });
        const text = firstText(result);
        expect(text).toContain('Resolve');
        expect(text).toContain('client');
        expect(text).toContain('workspace');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('get_ui_action', () => {
    it('returns a rich result with decoded placement and view restrictions', async () => {
      const getClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          sys_id: ref(EXISTING_SYS_ID),
          name: ref('Resolve'),
          table: ref('incident'),
          active: ref('true'),
          order: ref('100'),
          condition: ref("gs.hasRole('itil')"),
          client: ref('false'),
          form_button: ref('true'),
          show_insert: ref('true'),
          show_update: ref('true'),
          format_for_configurable_workspace: ref('true'),
          form_button_v2: ref('true'),
          client_script_v2: ref('function onClick(g_form) {}'),
        }),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: ref('v1'),
            sys_ui_view: ref('Mobile'),
            visibility: ref('include'),
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiActionTools, getClient);
      try {
        const result = (await pair.mcpClient.callTool({
          name: 'get_ui_action',
          arguments: { sys_id: EXISTING_SYS_ID },
        })) as { content: Array<{ text: string }> };
        const summary = result.content[0].text;
        expect(summary).toContain('UI Action: Resolve');
        expect(summary).toContain('Form:      button');
        expect(summary).toContain('Workspace: enabled');
        expect(summary).toContain('Mobile (include)');
        const json = JSON.parse(result.content[1].text);
        expect(json.workspace.enabled).toBe(true);
        expect(json.view_restrictions).toHaveLength(1);
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError for an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_ui_action',
        arguments: { sys_id: 'bad' },
      });
      expect(result.isError).toBe(true);
    });
  });
});
