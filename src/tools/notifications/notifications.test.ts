import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerNotificationTools } from './notifications.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

function ref(value: string, display = value) {
  return { value, display_value: display };
}

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn().mockResolvedValue({
      sys_id: ref(EXISTING_SYS_ID),
      name: ref('Incident assigned to me'),
      collection: ref('incident'),
      active: ref('true'),
      generation_type: ref('engine', 'Record inserted or updated'),
      action_insert: ref('true'),
      action_update: ref('false'),
      condition: ref('active=true'),
      advanced_condition: ref(''),
      event_name: ref(''),
      recipient_users: ref('abc123', 'Abel Tuter'),
      recipient_groups: ref('', ''),
      recipient_fields: ref('assigned_to'),
      send_self: ref('false'),
      event_parm_1: ref('false'),
      event_parm_2: ref('false'),
      subscribable: ref('false'),
      subject: ref('Incident ${number} assigned'),
      content_type: ref('text/html', 'HTML only'),
      template: ref('', ''),
      weight: ref('0'),
      importance: ref(''),
      mandatory: ref('false'),
      category: ref('cat123', 'Uncategorized'),
      digestable: ref('false'),
      omit_watermark: ref('false'),
      message_html: ref(
        'Hi ${assigned_to.name} ${mail_script:incident_details}',
      ),
      description: ref(''),
    }),
    getInstanceUrl: vi.fn().mockReturnValue('https://pdi.service-now.com'),
  } as unknown as ServiceNowClient;
}

describe('notification tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerNotificationTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_notification', () => {
    it('creates an insert/update notification and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_notification',
        arguments: {
          name: 'Incident assigned to me',
          collection: 'incident',
          action_insert: true,
          recipient_fields: 'assigned_to',
          subject: 'Incident assigned',
          message_html: '<p>You have a new incident.</p>',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('on insert');
      expect(result.isError).toBeFalsy();
    });

    it('serialises booleans/numbers to strings and applies defaults', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerNotificationTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_notification',
          arguments: {
            name: 'My Notif',
            collection: 'incident',
            action_update: true,
            weight: 5,
            recipient_users: 'abc123',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysevent_email_action',
          expect.objectContaining({
            name: 'My Notif',
            collection: 'incident',
            generation_type: 'engine',
            active: 'true',
            action_insert: 'false',
            action_update: 'true',
            send_self: 'true',
            content_type: 'text/html',
            weight: '5',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('GUARDRAIL: rejects generation_type=engine without a collection', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerNotificationTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_notification',
          arguments: { name: 'No Table', action_insert: true },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('requires a `collection`');
        expect(mockClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('GUARDRAIL: warns when engine notification has no insert/update trigger', async () => {
      const result = await mcpClient.callTool({
        name: 'create_notification',
        arguments: {
          name: 'Never fires',
          collection: 'incident',
          recipient_users: 'abc123',
        },
      });
      const text = firstText(result);
      expect(text).toContain('never fire');
      expect(result.isError).toBeFalsy();
    });

    it('GUARDRAIL: warns when event notification has no event_name', async () => {
      const result = await mcpClient.callTool({
        name: 'create_notification',
        arguments: {
          name: 'Eventless',
          generation_type: 'event',
          recipient_users: 'abc123',
        },
      });
      expect(firstText(result)).toContain('never fire');
    });

    it('GUARDRAIL: warns when no recipient source is set', async () => {
      const result = await mcpClient.callTool({
        name: 'create_notification',
        arguments: {
          name: 'Nobody',
          collection: 'incident',
          action_insert: true,
          send_self: false,
        },
      });
      const text = firstText(result);
      expect(text).toContain('send to nobody');
      expect(result.isError).toBeFalsy();
    });

    it('flags referenced ${mail_script:<name>} bodies', async () => {
      const result = await mcpClient.callTool({
        name: 'create_notification',
        arguments: {
          name: 'With script',
          collection: 'incident',
          action_insert: true,
          send_self: true,
          message_html: 'Hi ${mail_script:incident_details}',
        },
      });
      const text = firstText(result);
      expect(text).toContain('incident_details');
      expect(text).toContain('email scripts');
    });

    it('returns existing record without creating when name+collection exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerNotificationTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_notification',
          arguments: {
            name: 'Incident assigned to me',
            collection: 'incident',
            action_insert: true,
          },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
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
      const pair = await buildTestPair(registerNotificationTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_notification',
          arguments: { name: 'X', collection: 'incident', action_insert: true },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_notification', () => {
    it('patches the record and lists updated fields', async () => {
      const result = await mcpClient.callTool({
        name: 'update_notification',
        arguments: { sys_id: EXISTING_SYS_ID, active: false, weight: 10 },
      });
      const text = firstText(result);
      expect(text).toContain('updated successfully');
      expect(text).toContain(EXISTING_SYS_ID);
      expect(result.isError).toBeFalsy();
    });

    it('serialises the boolean to a string', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerNotificationTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_notification',
          arguments: { sys_id: EXISTING_SYS_ID, omit_watermark: true },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sysevent_email_action',
          EXISTING_SYS_ID,
          expect.objectContaining({ omit_watermark: 'true' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_notification',
        arguments: { sys_id: 'not-valid', name: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });

    it('returns no-op message when only sys_id is provided', async () => {
      const result = await mcpClient.callTool({
        name: 'update_notification',
        arguments: { sys_id: EXISTING_SYS_ID },
      });
      expect(firstText(result)).toContain('No fields to update');
    });
  });

  describe('list_notifications', () => {
    it('returns a no-match message when nothing matches', async () => {
      const result = await mcpClient.callTool({
        name: 'list_notifications',
        arguments: { collection: 'incident' },
      });
      expect(firstText(result)).toContain('No email notifications matched');
    });
  });

  describe('get_notification', () => {
    it('returns a two-block rich result with summary then JSON', async () => {
      const result = (await mcpClient.callTool({
        name: 'get_notification',
        arguments: { sys_id: EXISTING_SYS_ID },
      })) as { content: Array<{ type: string; text: string }> };
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Email Notification');
      const parsed = JSON.parse(result.content[1].text);
      expect(parsed.sys_id).toBe(EXISTING_SYS_ID);
      expect(parsed.generation_type).toBe('engine');
      expect(parsed.action_insert).toBe(true);
      expect(parsed.recipient_users).toBe('Abel Tuter');
      expect(parsed.mail_script_refs).toContain('incident_details');
    });

    it('returns isError when sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_notification',
        arguments: { sys_id: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });
});
