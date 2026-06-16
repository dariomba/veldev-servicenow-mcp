import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerInboundActionTools } from './inbound-actions.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: NEW_SYS_ID, display_value: NEW_SYS_ID },
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn().mockResolvedValue({
      sys_id: { value: EXISTING_SYS_ID, display_value: EXISTING_SYS_ID },
      name: { value: 'Create Incident', display_value: 'Create Incident' },
      type: { value: 'new', display_value: 'New' },
      action: { value: 'record_action', display_value: 'Record Action' },
      table: { value: 'incident', display_value: 'incident' },
      active: { value: 'true', display_value: 'true' },
      order: { value: '100', display_value: '100' },
      stop_processing: { value: 'false', display_value: 'false' },
      event_name: { value: 'email.read', display_value: 'email.read' },
      from: { value: '', display_value: '' },
      filter_condition: { value: '', display_value: '' },
      condition_script: { value: '', display_value: '' },
      script: {
        value: 'current.insert();',
        display_value: 'current.insert();',
      },
      reply_email: { value: '', display_value: '' },
      description: { value: '', display_value: '' },
      required_roles: { value: '', display_value: '' },
    }),
    getInstanceUrl: vi.fn().mockReturnValue('https://pdi.service-now.com'),
  } as unknown as ServiceNowClient;
}

describe('inbound-action tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerInboundActionTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_inbound_action', () => {
    it('creates a New action and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_inbound_action',
        arguments: {
          name: 'Create Incident',
          type: 'new',
          table: 'incident',
          script:
            'current.short_description = email.subject; current.insert();',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('Create Incident');
      expect(result.isError).toBeFalsy();
    });

    it('serialises booleans/numbers to strings and applies defaults', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerInboundActionTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_inbound_action',
          arguments: { name: 'My Action', type: 'new', table: 'incident' },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysevent_in_email_action',
          expect.objectContaining({
            name: 'My Action',
            type: 'new',
            action: 'record_action',
            table: 'incident',
            active: 'true',
            order: '100',
            stop_processing: 'false',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('GUARDRAIL: rejects type=new without a target table', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerInboundActionTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_inbound_action',
          arguments: { name: 'Missing Table', type: 'new' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('type=new requires');
        expect(mockClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('creates a Reply action without requiring a table', async () => {
      const result = await mcpClient.callTool({
        name: 'create_inbound_action',
        arguments: {
          name: 'Update Incident',
          type: 'reply',
          script: 'current.comments = email.body_text; current.update();',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created');
      expect(text).toContain('reply');
      expect(result.isError).toBeFalsy();
    });

    it('warns when action=reply_email but no reply body is set', async () => {
      const result = await mcpClient.callTool({
        name: 'create_inbound_action',
        arguments: {
          name: 'Auto Reply',
          type: 'reply',
          action: 'reply_email',
        },
      });
      const text = firstText(result);
      expect(text).toContain('WARNING');
      expect(text).toContain('reply_email');
      expect(result.isError).toBeFalsy();
    });

    it('returns existing record without creating when name+table already exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: {
              value: EXISTING_SYS_ID,
              display_value: EXISTING_SYS_ID,
            },
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerInboundActionTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_inbound_action',
          arguments: {
            name: 'Create Incident',
            type: 'new',
            table: 'incident',
          },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SYS_ID);
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
            new SnApiError(500, 'Internal Server Error', 'fault', 'https://x'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerInboundActionTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_inbound_action',
          arguments: { name: 'X', type: 'new', table: 'incident' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_inbound_action', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_inbound_action',
        arguments: { sys_id: EXISTING_SYS_ID, active: false, order: 50 },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('serialises the boolean to a string', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerInboundActionTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_inbound_action',
          arguments: { sys_id: EXISTING_SYS_ID, stop_processing: true },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sysevent_in_email_action',
          EXISTING_SYS_ID,
          expect.objectContaining({ stop_processing: 'true' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_inbound_action',
        arguments: { sys_id: 'not-valid', name: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('returns no-op message when only sys_id is provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_inbound_action',
        arguments: { sys_id: EXISTING_SYS_ID },
      });
      expect(firstText(result)).toContain('No fields to update');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('list_inbound_actions', () => {
    it('returns a no-match message when nothing matches', async () => {
      const result = await mcpClient.callTool({
        name: 'list_inbound_actions',
        arguments: { table: 'incident' },
      });
      expect(firstText(result)).toContain('No inbound email actions matched');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('get_inbound_action', () => {
    it('returns a two-block rich result with summary then JSON', async () => {
      const result = (await mcpClient.callTool({
        name: 'get_inbound_action',
        arguments: { sys_id: EXISTING_SYS_ID },
      })) as { content: Array<{ type: string; text: string }> };
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Inbound Email Action');
      const parsed = JSON.parse(result.content[1].text);
      expect(parsed.sys_id).toBe(EXISTING_SYS_ID);
      expect(parsed.type).toBe('new');
      expect(parsed.active).toBe(true);
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_inbound_action',
        arguments: { sys_id: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });
});
