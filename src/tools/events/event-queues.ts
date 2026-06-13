import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import {
  handleError,
  isSysId,
  resolveDisplay,
  resolveValue,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  EventQueueCreate,
  EventQueueList,
  EventQueueUpdate,
} from './schemas.js';

const TABLE = 'sysevent_queue';

// Default "System Queue" provider — sysevent_queue.provider is mandatory and this
// is the platform default (sysevent_queue.dictionary default_value).
const DEFAULT_PROVIDER = '44af4464431212108da9a574a9b8f2f5';

type SnRecord = Record<string, SnReference | undefined>;

const val = (r: SnRecord, f: string): string =>
  r[f] ? resolveValue(r[f] as SnReference) : '';
const disp = (r: SnRecord, f: string): string =>
  r[f] ? resolveDisplay(r[f] as SnReference) : '';

/**
 * poll_interval is a glide_duration, stored as a date/time offset from the
 * 1970-01-01 epoch: 30s → "1970-01-01 00:00:30", 1 day → "1970-01-02 00:00:00".
 */
function secondsToDuration(seconds: number): string {
  const d = new Date(Date.UTC(1970, 0, 1) + seconds * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function recordUrl(client: ServiceNowClient, sysId: string): string {
  return `${client.getInstanceUrl()}/${TABLE}.do?sys_id=${sysId}`;
}

interface QueueInput {
  description?: string;
  processing_order?: 'parallel' | 'sequential';
  job_config?: 'jobs_per_node' | 'job_count';
  job_config_value?: number;
  poll_interval_seconds?: number;
  automatic_processing?: boolean;
  suffix?: string;
}

function applyQueueFields(
  body: Record<string, unknown>,
  input: QueueInput,
): void {
  if (input.description !== undefined) body.description = input.description;
  if (input.processing_order !== undefined)
    body.processing_order = input.processing_order;
  if (input.job_config !== undefined) body.job_config = input.job_config;
  if (input.job_config_value !== undefined)
    body.job_config_value = String(input.job_config_value);
  if (input.poll_interval_seconds !== undefined)
    body.poll_interval = secondsToDuration(input.poll_interval_seconds);
  if (input.automatic_processing !== undefined)
    body.automatic_processing = String(input.automatic_processing);
  if (input.suffix !== undefined) body.suffix = input.suffix;
}

export function registerEventQueueTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_event_queue',
    {
      access: 'write',
      title: 'Create Event Queue',
      description: [
        'Creates a custom event processing queue (sysevent_queue). Event registrations',
        'route to it by setting their `queue` field to this queue name.',
        '',
        'WHEN TO USE: when a workflow fires a high volume of events that would otherwise',
        "starve the shared 'DEFAULT' queue — give them an isolated queue.",
        '',
        'queue must be lowercase letters/digits/underscores only. processing_order',
        "defaults to 'parallel'; use 'sequential' only when events must be processed in",
        'order. poll_interval_seconds defaults to 30.',
        '',
        'Idempotent: if a queue with the same name already exists, its sys_id is returned',
        'and no new record is created.',
      ].join('\n'),
      inputSchema: EventQueueCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ queue, ...rest }) => {
      try {
        const existing = await client.listRecords<SnRecord>(
          TABLE,
          `queue=${queue}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Event queue "${queue}" already exists — skipped.`,
                  `sys_id: ${val(existing[0], 'sys_id')}`,
                ].join('\n'),
              },
            ],
          };
        }

        const body: Record<string, unknown> = {
          queue,
          provider: DEFAULT_PROVIDER,
        };
        applyQueueFields(body, rest);

        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Event queue created.',
                '',
                `queue:            ${queue}`,
                `processing_order: ${rest.processing_order ?? 'parallel'}`,
                `poll_interval:    ${rest.poll_interval_seconds ?? 30}s`,
                `sys_id:           ${sys_id}`,
                `URL:              ${recordUrl(client, sys_id)}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_event_queue',
    {
      access: 'write',
      title: 'Update Event Queue',
      description: [
        'Updates fields on an existing sysevent_queue record.',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
      ].join('\n'),
      inputSchema: EventQueueUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, queue, ...rest }) => {
      try {
        if (!isSysId(sys_id))
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid sysevent_queue sys_id.`,
              },
            ],
            isError: true,
          };

        const body: Record<string, unknown> = {};
        if (queue !== undefined) body.queue = queue;
        applyQueueFields(body, rest);

        if (Object.keys(body).length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No fields to update — all values were omitted.',
              },
            ],
          };
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Event queue updated successfully.',
                '',
                `sys_id:         ${sys_id}`,
                `Updated fields: ${Object.keys(body).join(', ')}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_event_queues',
    {
      access: 'read',
      title: 'List Event Queues',
      description: [
        'Lists custom event processing queues (sysevent_queue), optionally filtered by',
        'name substring.',
      ].join('\n'),
      inputSchema: EventQueueList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, limit }) => {
      try {
        const clauses: string[] = [];
        if (name_contains) clauses.push(`queueLIKE${name_contains}`);
        clauses.push('ORDERBYqueue');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'queue',
            'processing_order',
            'poll_interval',
            'automatic_processing',
          ],
          limit,
        );

        const summary = rows.length
          ? rows
              .map(
                (r) =>
                  `${val(r, 'queue')} — ${disp(r, 'processing_order')} — poll ${disp(r, 'poll_interval')} — ${val(r, 'sys_id')}`,
              )
              .join('\n')
          : 'No event queues matched.';

        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
