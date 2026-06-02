import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerUiPolicyTools } from '../tools/ui-policy-write.js';

const ITEM_SYS_ID = '7bad3ce593700310eb4cf83bdd03d69d';
const POLICY_SYS_ID = 'aaaa1111cccc2222aaaa1111cccc2222';
const NEW_POLICY_SYS_ID = 'bbbb3333dddd4444bbbb3333dddd4444';
const ACTION_SYS_ID = 'cccc5555eeee6666cccc5555eeee6666';
const NEW_ACTION_SYS_ID = 'dddd7777ffff8888dddd7777ffff8888';
const VAR_SYS_ID = 'eeee9999aaaa0000eeee9999aaaa0000';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockImplementation((table: string) => {
      if (table === 'catalog_ui_policy') {
        return Promise.resolve({
          sys_id: {
            value: NEW_POLICY_SYS_ID,
            display_value: NEW_POLICY_SYS_ID,
          },
        });
      }
      return Promise.resolve({
        sys_id: { value: NEW_ACTION_SYS_ID, display_value: NEW_ACTION_SYS_ID },
      });
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue(undefined),
  } as unknown as ServiceNowClient;
}

describe('ui-policy-write tools (in-memory MCP)', () => {
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

  describe('batch_create_ui_policies', () => {
    it('creates policies and returns sys_ids in summary', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policies',
        arguments: {
          policies: [
            {
              short_description: 'Show extra field when type is Other',
              applies_to: 'item',
              catalog_item: ITEM_SYS_ID,
              catalog_conditions: `IO:${VAR_SYS_ID}=Other^EQ`,
            },
          ],
        },
      });
      const text = firstText(result);
      expect(text).toContain('UI Policies created: 1');
      expect(text).toContain(NEW_POLICY_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when applies_to=item but catalog_item is missing', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policies',
        arguments: {
          policies: [
            {
              short_description: 'My Policy',
              applies_to: 'item',
              // catalog_item intentionally omitted
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('catalog_item is required');
    });

    it('returns isError when catalog_item is not a valid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policies',
        arguments: {
          policies: [
            {
              short_description: 'My Policy',
              applies_to: 'item',
              catalog_item: 'not-a-valid-id',
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid catalog item sys_id');
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
      const pair = await buildTestPair(registerUiPolicyTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_ui_policies',
          arguments: {
            policies: [
              {
                short_description: 'My Policy',
                applies_to: 'item',
                catalog_item: ITEM_SYS_ID,
              },
            ],
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

  describe('batch_create_ui_policy_actions', () => {
    const validAction = {
      ui_policy: POLICY_SYS_ID,
      catalog_item: ITEM_SYS_ID,
      catalog_variable: `IO:${VAR_SYS_ID}`,
      visible: 'true' as const,
    };

    it('creates actions and returns summary', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policy_actions',
        arguments: { actions: [validAction] },
      });
      const text = firstText(result);
      expect(text).toContain('Created: 1');
      expect(result.isError).toBeFalsy();
    });

    it('skips existing action and reports in summary', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([
            { sys_id: { value: ACTION_SYS_ID, display_value: ACTION_SYS_ID } },
          ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiPolicyTools, idempotentClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_ui_policy_actions',
          arguments: { actions: [validAction] },
        });
        const text = firstText(result);
        expect(text).toContain('Skipped');
        expect(text).toContain(ACTION_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when ui_policy is not a valid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policy_actions',
        arguments: {
          actions: [{ ...validAction, ui_policy: 'bad-id' }],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid UI Policy sys_id');
    });

    it('returns isError when catalog_item is not a valid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policy_actions',
        arguments: {
          actions: [{ ...validAction, catalog_item: 'bad-id' }],
        },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when mandatory and disabled are both true', async () => {
      const result = await mcpClient.callTool({
        name: 'batch_create_ui_policy_actions',
        arguments: {
          actions: [
            {
              ...validAction,
              mandatory: 'true' as const,
              disabled: 'true' as const,
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('mandatory and disabled cannot both be');
    });

    it('triggers background script after creating actions', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'batch_create_ui_policy_actions',
          arguments: { actions: [validAction] },
        });
        expect(
          mockClient.executeBackgroundScriptTrigger,
        ).toHaveBeenCalledOnce();
      } finally {
        await pair.teardown();
      }
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
              'fault',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiPolicyTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'batch_create_ui_policy_actions',
          arguments: { actions: [validAction] },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_ui_policy', () => {
    it('patches the record and returns success', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_policy',
        arguments: { sys_id: POLICY_SYS_ID, active: false },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(POLICY_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_policy',
        arguments: { sys_id: 'bad-id', active: false },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when catalog_item is not a valid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_policy',
        arguments: { sys_id: POLICY_SYS_ID, catalog_item: 'bad-id' },
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
      const pair = await buildTestPair(registerUiPolicyTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_ui_policy',
          arguments: { sys_id: POLICY_SYS_ID, active: true },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('404');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_ui_policy_action', () => {
    it('patches the record and returns success', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_policy_action',
        arguments: { sys_id: ACTION_SYS_ID, visible: 'false' as const },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(ACTION_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_policy_action',
        arguments: { sys_id: 'bad-id', visible: 'true' as const },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError when mandatory and disabled are both true', async () => {
      const result = await mcpClient.callTool({
        name: 'update_ui_policy_action',
        arguments: {
          sys_id: ACTION_SYS_ID,
          mandatory: 'true' as const,
          disabled: 'true' as const,
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('mandatory and disabled cannot both be');
    });

    it('triggers background script when catalog_variable is updated', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerUiPolicyTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_ui_policy_action',
          arguments: {
            sys_id: ACTION_SYS_ID,
            catalog_variable: `IO:${VAR_SYS_ID}`,
          },
        });
        expect(
          mockClient.executeBackgroundScriptTrigger,
        ).toHaveBeenCalledOnce();
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        patchRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(403, 'Forbidden', 'ACL', 'https://example.com'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerUiPolicyTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_ui_policy_action',
          arguments: { sys_id: ACTION_SYS_ID, visible: 'true' as const },
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
