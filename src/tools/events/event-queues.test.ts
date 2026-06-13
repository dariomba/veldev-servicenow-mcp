import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerEventQueueTools } from './event-queues.js';

const NEW_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const EXISTING_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

const ref = (value: string) => ({ value, display_value: value });

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
  } as unknown as ServiceNowClient;
}

describe('event queue tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerEventQueueTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_event_queue', () => {
    it('sets the default provider and converts poll_interval_seconds to a duration', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerEventQueueTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_event_queue',
          arguments: {
            queue: 'acme_queue',
            processing_order: 'sequential',
            poll_interval_seconds: 90,
            job_config_value: 3,
          },
        });
        expect(firstText(result)).toContain('Event queue created');
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysevent_queue',
          expect.objectContaining({
            queue: 'acme_queue',
            provider: '44af4464431212108da9a574a9b8f2f5',
            processing_order: 'sequential',
            poll_interval: '1970-01-01 00:01:30',
            job_config_value: '3',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid queue name', async () => {
      const result = await mcpClient.callTool({
        name: 'create_event_queue',
        arguments: { queue: 'Bad Name' },
      });
      expect(result.isError).toBe(true);
    });

    it('is idempotent on queue name', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerEventQueueTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_event_queue',
          arguments: { queue: 'acme_queue' },
        });
        expect(firstText(result)).toContain('already exists');
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('list_event_queues', () => {
    it('summarizes matching queues', async () => {
      const listClient = {
        ...buildMockClient(),
        listRecords: vi.fn().mockResolvedValue([
          {
            sys_id: ref(NEW_SYS_ID),
            queue: ref('acme_queue'),
            processing_order: ref('parallel'),
            poll_interval: ref('30 Seconds'),
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerEventQueueTools, listClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_event_queues',
          arguments: {},
        });
        expect(firstText(result)).toContain('acme_queue');
      } finally {
        await pair.teardown();
      }
    });
  });
});
