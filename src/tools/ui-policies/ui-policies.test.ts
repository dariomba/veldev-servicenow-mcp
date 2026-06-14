import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerUiPolicyTools } from './ui-policies.js';

const NEW_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const POLICY_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

const ref = (value: string) => ({ value, display_value: value });

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn(),
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
  } as unknown as ServiceNowClient;
}

describe('form UI policy tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerUiPolicyTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_form_ui_policy', () => {
    it('serialises booleans and maps ui_type, defaulting unspecified fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_form_ui_policy',
          arguments: {
            short_description: 'Hide caller when self-service',
            table: 'incident',
            conditions: 'contact_type=self-service',
            ui_type: 'desktop',
          },
        });
        const text = firstText(result);
        expect(text).toContain('Form UI Policy created');
        expect(text).toContain(NEW_SYS_ID);
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_ui_policy',
          expect.objectContaining({
            short_description: 'Hide caller when self-service',
            table: 'incident',
            conditions: 'contact_type=self-service',
            active: 'true',
            on_load: 'true',
            reverse_if_false: 'true',
            run_scripts: 'false',
            global: 'true',
            inherit: 'false',
            order: '100',
            ui_type: '0',
          }),
        );
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('passes through a supplied script and drops view on a global policy', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_form_ui_policy',
          arguments: {
            short_description: 'No scripts',
            table: 'incident',
            script_true: 'function onCondition() {}',
            view: 'aaaa1111bbbb2222aaaa1111bbbb2222',
          },
        });
        const body = (mockClient.createRecord as ReturnType<typeof vi.fn>).mock
          .calls[0][1];
        expect(body.script_true).toBe('function onCondition() {}');
        // view is ignored while global defaults to true.
        expect(body).not.toHaveProperty('view');
        expect(body.ui_type).toBe('10'); // default 'all'
      } finally {
        await pair.teardown();
      }
    });

    it('keeps view when the policy is scoped to a single view (global=false)', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_form_ui_policy',
          arguments: {
            short_description: 'Scoped',
            table: 'incident',
            global: false,
            view: 'aaaa1111bbbb2222aaaa1111bbbb2222',
          },
        });
        const body = (mockClient.createRecord as ReturnType<typeof vi.fn>).mock
          .calls[0][1];
        expect(body.global).toBe('false');
        expect(body.view).toBe('aaaa1111bbbb2222aaaa1111bbbb2222');
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError with status', async () => {
      const errorClient = {
        ...buildMockClient(),
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(403, 'Forbidden', 'ACL', 'https://example.com'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiPolicyTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_form_ui_policy',
          arguments: { short_description: 'x', table: 'incident' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_form_ui_policy', () => {
    it('patches only supplied fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_form_ui_policy',
          arguments: { sys_id: POLICY_SYS_ID, active: false, order: 200 },
        });
        expect(firstText(result)).toContain('updated successfully');
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_ui_policy',
          POLICY_SYS_ID,
          { active: 'false', order: '200' },
        );
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_form_ui_policy',
        arguments: { sys_id: 'nope', active: false },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });

  describe('get_form_ui_policy', () => {
    it('returns a two-block summary with its policy actions', async () => {
      const richClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          sys_id: ref(POLICY_SYS_ID),
          short_description: ref('Hide caller'),
          table: ref('incident'),
          conditions: ref('contact_type=self-service'),
          active: ref('true'),
          on_load: ref('true'),
          reverse_if_false: ref('true'),
          run_scripts: ref('false'),
          global: ref('true'),
          inherit: ref('false'),
          order: ref('100'),
          ui_type: ref('10'),
        }),
        listRecords: vi
          .fn()
          // first call: field actions; second call: related list actions
          .mockResolvedValueOnce([
            {
              sys_id: ref('11112222333344445555666677778888'),
              field: ref('caller_id'),
              visible: ref('false'),
              mandatory: ref('ignore'),
              disabled: ref('ignore'),
              value_action: ref('ignore'),
              value: ref(''),
              field_message_type: ref('none'),
              field_message: ref(''),
            },
          ])
          .mockResolvedValueOnce([
            {
              sys_id: ref('99998888777766665555444433332222'),
              list: ref('task.parent'),
              visible: ref('false'),
            },
          ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiPolicyTools, richClient);
      try {
        const result = (await pair.mcpClient.callTool({
          name: 'get_form_ui_policy',
          arguments: { sys_id: POLICY_SYS_ID },
        })) as { content: Array<{ text: string }>; isError?: boolean };
        expect(result.content).toHaveLength(2);
        expect(result.content[0].text).toContain('caller_id');
        const json = JSON.parse(result.content[1].text);
        expect(json.table).toBe('incident');
        expect(json.ui_type).toBe('all');
        expect(json.actions).toHaveLength(1);
        expect(json.actions[0].visible).toBe('false');
        expect(json.related_list_actions).toHaveLength(1);
        expect(json.related_list_actions[0].list).toBe('task.parent');
        expect(result.content[0].text).toContain('Related list actions (1)');
      } finally {
        await pair.teardown();
      }
    });
  });
});
