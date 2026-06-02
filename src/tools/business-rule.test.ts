import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerBusinessRuleTools } from '../tools/business-rule.js';

const EXISTING_RULE_SYS_ID = 'bbbb1111aaaa2222bbbb1111aaaa2222';
const NEW_RULE_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: NEW_RULE_SYS_ID, display_value: NEW_RULE_SYS_ID },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceNowClient;
}

describe('business-rule tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerBusinessRuleTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_business_rule', () => {
    it('creates the rule and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_business_rule',
        arguments: {
          name: 'Set Priority on Insert',
          collection: 'incident',
          advanced: true,
          action_insert: true,
          when: 'before',
          script:
            '(function executeRule(current, previous) { current.priority = 2; })(current, previous);',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created successfully');
      expect(text).toContain(NEW_RULE_SYS_ID);
      expect(text).toContain('Set Priority on Insert');
      expect(result.isError).toBeFalsy();
    });

    it('calls createRecord with name, collection, and correct boolean strings', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerBusinessRuleTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_business_rule',
          arguments: {
            name: 'My Rule',
            collection: 'change_request',
            action_insert: true,
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_script',
          expect.objectContaining({
            name: 'My Rule',
            collection: 'change_request',
            action_insert: 'true',
            active: 'true',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns existing record without creating when name+collection already exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: EXISTING_RULE_SYS_ID,
              display_value: EXISTING_RULE_SYS_ID,
            },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerBusinessRuleTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_business_rule',
          arguments: { name: 'My Rule', collection: 'incident' },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_RULE_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
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
              500,
              'Internal Server Error',
              'fault',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerBusinessRuleTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_business_rule',
          arguments: { name: 'My Rule', collection: 'incident' },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('500');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects empty name with Zod validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_business_rule',
        arguments: { name: '', collection: 'incident' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('update_business_rule', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_business_rule',
        arguments: {
          sys_id: EXISTING_RULE_SYS_ID,
          name: 'Renamed Rule',
          active: false,
        },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_RULE_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('calls patchRecord with correctly serialised boolean string', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerBusinessRuleTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_business_rule',
          arguments: { sys_id: EXISTING_RULE_SYS_ID, active: false },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_script',
          EXISTING_RULE_SYS_ID,
          expect.objectContaining({ active: 'false' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_business_rule',
        arguments: { sys_id: 'not-a-valid-id', name: 'x' },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid');
    });

    it('returns no-op message when no fields are provided besides sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_business_rule',
        arguments: { sys_id: EXISTING_RULE_SYS_ID },
      });
      const text = firstText(result);
      expect(text).toContain('No fields to update');
      expect(result.isError).toBeFalsy();
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
      const pair = await buildTestPair(registerBusinessRuleTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_business_rule',
          arguments: { sys_id: EXISTING_RULE_SYS_ID, name: 'New Name' },
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
