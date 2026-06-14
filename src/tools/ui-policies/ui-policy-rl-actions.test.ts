import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerUiPolicyRlActionTools } from './ui-policy-rl-actions.js';

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
    getRecord: vi.fn(),
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue({}),
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
  } as unknown as ServiceNowClient;
}

describe('form UI policy related list action tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerUiPolicyRlActionTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_form_ui_policy_rl_actions', () => {
    it('creates several related list actions and re-links once', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerUiPolicyRlActionTools,
        mockClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_form_ui_policy_rl_actions',
          arguments: {
            actions: [
              {
                ui_policy: POLICY_SYS_ID,
                list: 'incident.parent_incident',
                visible: 'false',
              },
              {
                ui_policy: POLICY_SYS_ID,
                list: 'task_ci.task',
                visible: 'true',
              },
            ],
          },
        });
        expect(firstText(result)).toContain('related list actions created: 2');
        expect(mockClient.createRecord).toHaveBeenNthCalledWith(
          1,
          'sys_ui_policy_rl_action',
          {
            ui_policy: POLICY_SYS_ID,
            list: 'incident.parent_incident',
            visible: 'false',
          },
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
        expect(script).toContain('sys_ui_policy_rl_action');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid ui_policy sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_form_ui_policy_rl_actions',
        arguments: { actions: [{ ui_policy: 'nope', list: 'task.parent' }] },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });

  describe('update_form_ui_policy_rl_action', () => {
    it('patches only supplied fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerUiPolicyRlActionTools,
        mockClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_form_ui_policy_rl_action',
          arguments: { sys_id: ACTION_SYS_ID, visible: 'true' },
        });
        expect(firstText(result)).toContain('updated successfully');
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_ui_policy_rl_action',
          ACTION_SYS_ID,
          { visible: 'true' },
        );
        // No parent reassignment → no server-side re-link.
        expect(
          mockClient.executeBackgroundScriptTrigger,
        ).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_form_ui_policy_rl_action',
        arguments: { sys_id: 'nope', visible: 'true' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });
});
