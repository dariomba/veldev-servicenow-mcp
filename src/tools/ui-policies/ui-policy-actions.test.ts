import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerUiPolicyActionTools } from './ui-policy-actions.js';

const NEW_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const SECOND_SYS_ID = 'bbbb2222cccc3333bbbb2222cccc3333';
const POLICY_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';
const ACTION_SYS_ID = 'eeee5555ffff6666eeee5555ffff6666';

const ref = (value: string) => ({ value, display_value: value });

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi
      .fn()
      .mockResolvedValueOnce({ sys_id: ref(NEW_SYS_ID) })
      .mockResolvedValueOnce({ sys_id: ref(SECOND_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn().mockResolvedValue({ table: ref('incident') }),
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue({}),
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
  } as unknown as ServiceNowClient;
}

describe('form UI policy action tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerUiPolicyActionTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_form_ui_policy_actions', () => {
    it('creates several actions, inherits the table, and re-links once', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyActionTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_form_ui_policy_actions',
          arguments: {
            actions: [
              {
                ui_policy: POLICY_SYS_ID,
                field: 'caller_id',
                visible: 'false',
              },
              {
                ui_policy: POLICY_SYS_ID,
                field: 'priority',
                value_action: 'set_value',
                value: '1',
              },
            ],
          },
        });
        expect(firstText(result)).toContain(
          'Form UI Policy actions created: 2',
        );
        // table resolved once for the shared parent policy, not per action.
        expect(mockClient.getRecord).toHaveBeenCalledTimes(1);
        expect(mockClient.getRecord).toHaveBeenCalledWith(
          'sys_ui_policy',
          POLICY_SYS_ID,
          ['table'],
        );
        expect(mockClient.createRecord).toHaveBeenNthCalledWith(
          1,
          'sys_ui_policy_action',
          expect.objectContaining({ field: 'caller_id', table: 'incident' }),
        );
        expect(mockClient.createRecord).toHaveBeenNthCalledWith(
          2,
          'sys_ui_policy_action',
          expect.objectContaining({ field: 'priority', value: '1' }),
        );
        // One background script re-links both new actions.
        expect(mockClient.executeBackgroundScriptTrigger).toHaveBeenCalledTimes(
          1,
        );
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(script).toContain(NEW_SYS_ID);
        expect(script).toContain(SECOND_SYS_ID);
        expect(script).toContain(POLICY_SYS_ID);
        expect(script).toContain('sys_ui_policy_action');
      } finally {
        await pair.teardown();
      }
    });

    it('does not look up the policy when every action supplies a table', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyActionTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_form_ui_policy_actions',
          arguments: {
            actions: [
              { ui_policy: POLICY_SYS_ID, field: 'priority', table: 'task' },
            ],
          },
        });
        expect(mockClient.getRecord).not.toHaveBeenCalled();
        const body = (mockClient.createRecord as ReturnType<typeof vi.fn>).mock
          .calls[0][1];
        expect(body.table).toBe('task');
      } finally {
        await pair.teardown();
      }
    });

    it("rejects mandatory='true' together with disabled='true'", async () => {
      const result = await mcpClient.callTool({
        name: 'create_form_ui_policy_actions',
        arguments: {
          actions: [
            {
              ui_policy: POLICY_SYS_ID,
              field: 'caller_id',
              mandatory: 'true',
              disabled: 'true',
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('cannot both be');
    });

    it("requires value when value_action='set_value'", async () => {
      const result = await mcpClient.callTool({
        name: 'create_form_ui_policy_actions',
        arguments: {
          actions: [
            {
              ui_policy: POLICY_SYS_ID,
              field: 'caller_id',
              value_action: 'set_value',
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('value is required');
    });

    it('rejects an invalid ui_policy sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_form_ui_policy_actions',
        arguments: {
          actions: [{ ui_policy: 'nope', field: 'caller_id' }],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });

  describe('update_form_ui_policy_action', () => {
    it('patches only supplied fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyActionTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_form_ui_policy_action',
          arguments: { sys_id: ACTION_SYS_ID, mandatory: 'true' },
        });
        expect(firstText(result)).toContain('updated successfully');
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_ui_policy_action',
          ACTION_SYS_ID,
          { mandatory: 'true' },
        );
        // No parent reassignment → no server-side re-link needed.
        expect(
          mockClient.executeBackgroundScriptTrigger,
        ).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('re-links the parent policy server-side when ui_policy changes', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyActionTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_form_ui_policy_action',
          arguments: { sys_id: ACTION_SYS_ID, ui_policy: POLICY_SYS_ID },
        });
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(script).toContain(ACTION_SYS_ID);
        expect(script).toContain(POLICY_SYS_ID);
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_form_ui_policy_action',
        arguments: { sys_id: 'nope', visible: 'true' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });
});
