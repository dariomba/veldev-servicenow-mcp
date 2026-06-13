import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerEventRegistrationTools } from './event-registrations.js';

const NEW_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const EXISTING_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

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

describe('event registration tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerEventRegistrationTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_event_registration', () => {
    it('creates the record and maps caller_access enum to its code', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerEventRegistrationTools,
        mockClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_event_registration',
          arguments: {
            event_name: 'x_acme.thing.done',
            table: 'incident',
            queue: 'acme_queue',
            caller_access: 'restriction',
          },
        });
        const text = firstText(result);
        expect(text).toContain('Event registered');
        expect(text).toContain(NEW_SYS_ID);
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysevent_register',
          expect.objectContaining({
            event_name: 'x_acme.thing.done',
            table: 'incident',
            queue: 'acme_queue',
            caller_access: '2',
          }),
        );
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });

    it('is idempotent on event_name', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerEventRegistrationTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_event_registration',
          arguments: { event_name: 'x_acme.thing.done' },
        });
        expect(firstText(result)).toContain('already registered');
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
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
      const pair = await buildTestPair(
        registerEventRegistrationTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_event_registration',
          arguments: { event_name: 'x_acme.thing.done' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_event_registration', () => {
    it('patches only supplied fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerEventRegistrationTools,
        mockClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_event_registration',
          arguments: { sys_id: EXISTING_SYS_ID, queue: 'other_queue' },
        });
        expect(firstText(result)).toContain('updated successfully');
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sysevent_register',
          EXISTING_SYS_ID,
          { queue: 'other_queue' },
        );
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_event_registration',
        arguments: { sys_id: 'nope', queue: 'q' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });

  describe('get_event', () => {
    it('returns a two-block summary with its listening script actions', async () => {
      const richClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          sys_id: ref(EXISTING_SYS_ID),
          event_name: ref('x_acme.thing.done'),
          table: ref('incident'),
          queue: ref('acme_queue'),
        }),
        listRecords: vi
          .fn()
          // first call: script actions; second call: queue lookup
          .mockResolvedValueOnce([
            {
              sys_id: ref('11112222333344445555666677778888'),
              name: ref('Handle Thing'),
              active: ref('true'),
              order: ref('100'),
              synchronous: ref('false'),
            },
          ])
          .mockResolvedValueOnce([{ sys_id: ref('q1') }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerEventRegistrationTools,
        richClient,
      );
      try {
        const result = (await pair.mcpClient.callTool({
          name: 'get_event',
          arguments: { sys_id: EXISTING_SYS_ID },
        })) as { content: Array<{ text: string }>; isError?: boolean };
        expect(result.content).toHaveLength(2);
        expect(result.content[0].text).toContain('Handle Thing');
        const json = JSON.parse(result.content[1].text);
        expect(json.event_name).toBe('x_acme.thing.done');
        expect(json.script_actions).toHaveLength(1);
        expect(json.queue_registered).toBe(true);
      } finally {
        await pair.teardown();
      }
    });
  });
});
