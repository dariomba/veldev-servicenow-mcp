import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord } from '../../types/servicenow.js';
import {
  disp,
  errText,
  handleError,
  recordUrl,
  requireSysId,
  richResult,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  EventGet,
  EventList,
  EventRegistrationCreate,
  EventRegistrationUpdate,
} from './schemas.js';

const TABLE = 'sysevent_register';
const SCRIPT_ACTION_TABLE = 'sysevent_script_action';
const QUEUE_TABLE = 'sysevent_queue';

const CALLER_ACCESS: Record<string, string> = {
  tracking: '1',
  restriction: '2',
};

export function registerEventRegistrationTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_event_registration',
    {
      access: 'write',
      title: 'Register Event',
      description: [
        'Registers an event in the Event Registry (sysevent_register) so it can be',
        'fired with gs.eventQueue() and listened to by script actions and notifications.',
        '',
        "event_name follows the '<table>.<verb>' convention, e.g. 'incident.commented'.",
        'The table prefix is not added automatically — include it yourself.',
        'Set `queue` to route processing to a custom queue (see create_event_queue);',
        "omit it to use the built-in 'DEFAULT' queue.",
        '',
        'Idempotent: if an event with the same event_name already exists, its sys_id is',
        'returned and no new record is created.',
      ].join('\n'),
      inputSchema: EventRegistrationCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      event_name,
      table,
      queue,
      description,
      fired_by,
      priority,
      suffix,
      caller_access,
    }) => {
      try {
        const existing = await client.listRecords<SnRecord>(
          TABLE,
          `event_name=${event_name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          const sys_id = val(existing[0], 'sys_id');
          return textResult(
            [
              `Event "${event_name}" is already registered — skipped.`,
              `sys_id: ${sys_id}`,
            ].join('\n'),
          );
        }

        const body: Record<string, unknown> = { event_name };
        if (table !== undefined) body.table = table;
        if (queue !== undefined) body.queue = queue;
        if (description !== undefined) body.description = description;
        if (fired_by !== undefined) body.fired_by = fired_by;
        if (priority !== undefined) body.priority = String(priority);
        if (suffix !== undefined) body.suffix = suffix;
        if (caller_access !== undefined)
          body.caller_access = CALLER_ACCESS[caller_access];

        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        return textResult(
          [
            'Event registered.',
            '',
            `event_name: ${event_name}`,
            `table:      ${table ?? '—'}`,
            `queue:      ${queue ?? 'DEFAULT'}`,
            `sys_id:     ${sys_id}`,
            `URL:        ${recordUrl(client, TABLE, sys_id)}`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_event_registration',
    {
      access: 'write',
      title: 'Update Event Registration',
      description: [
        'Updates fields on an existing sysevent_register record.',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
      ].join('\n'),
      inputSchema: EventRegistrationUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      event_name,
      table,
      queue,
      description,
      fired_by,
      priority,
      suffix,
      caller_access,
    }) => {
      try {
        const err = requireSysId(sys_id, 'sysevent_register sys_id');
        if (err) return errText(err);

        const body: Record<string, unknown> = {};
        if (event_name !== undefined) body.event_name = event_name;
        if (table !== undefined) body.table = table;
        if (queue !== undefined) body.queue = queue;
        if (description !== undefined) body.description = description;
        if (fired_by !== undefined) body.fired_by = fired_by;
        if (priority !== undefined) body.priority = String(priority);
        if (suffix !== undefined) body.suffix = suffix;
        if (caller_access !== undefined)
          body.caller_access = CALLER_ACCESS[caller_access];

        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);
        return textResult(
          [
            'Event registration updated successfully.',
            '',
            `sys_id:         ${sys_id}`,
            `Updated fields: ${Object.keys(body).join(', ')}`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_events',
    {
      access: 'read',
      title: 'List Registered Events',
      description: [
        'Lists events from the Event Registry (sysevent_register), optionally filtered',
        'by name substring or table.',
      ].join('\n'),
      inputSchema: EventList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, table, limit }) => {
      try {
        const clauses: string[] = [];
        if (name_contains) clauses.push(`event_nameLIKE${name_contains}`);
        if (table) clauses.push(`table=${table}`);
        clauses.push('ORDERBYevent_name');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          ['sys_id', 'event_name', 'table', 'queue', 'description'],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const q = val(r, 'queue') || 'DEFAULT';
                const tbl = disp(r, 'table');
                return `${val(r, 'event_name')} — queue ${q}${tbl ? ` — ${tbl}` : ''} — ${val(r, 'sys_id')}`;
              })
              .join('\n')
          : 'No registered events matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_event',
    {
      access: 'read',
      title: 'Get Registered Event',
      description: [
        'Reads a single registered event (sysevent_register) with its resolved queue',
        'and the script actions that listen on it.',
      ].join('\n'),
      inputSchema: EventGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const err = requireSysId(sys_id, 'sysevent_register sys_id');
        if (err) return errText(err);

        const base = await client.getRecord<SnRecord>(TABLE, sys_id, [
          'sys_id',
          'event_name',
          'table',
          'queue',
          'description',
          'fired_by',
          'priority',
          'caller_access',
        ]);

        const eventName = val(base, 'event_name');
        const queueName = val(base, 'queue');

        const [actions, queues] = await Promise.all([
          client.listRecords<SnRecord>(
            SCRIPT_ACTION_TABLE,
            `event_name=${eventName}^ORDERBYorder`,
            ['sys_id', 'name', 'active', 'order', 'synchronous'],
            50,
          ),
          queueName
            ? client.listRecords<SnRecord>(
                QUEUE_TABLE,
                `queue=${queueName}`,
                ['sys_id', 'queue', 'processing_order', 'poll_interval'],
                1,
              )
            : Promise.resolve<SnRecord[]>([]),
        ]);

        const listeners = actions.map((a) => ({
          sys_id: val(a, 'sys_id'),
          name: disp(a, 'name'),
          active: val(a, 'active') === 'true',
          order: val(a, 'order'),
          synchronous: val(a, 'synchronous') === 'true',
        }));

        const result = {
          sys_id: val(base, 'sys_id'),
          event_name: eventName,
          table: disp(base, 'table'),
          queue: queueName || 'DEFAULT',
          queue_registered: queues.length > 0,
          description: disp(base, 'description'),
          fired_by: disp(base, 'fired_by'),
          priority: val(base, 'priority'),
          caller_access: disp(base, 'caller_access'),
          url: recordUrl(client, TABLE, sys_id),
          script_actions: listeners,
        };

        const summary = [
          `Event:    ${result.event_name} (${result.sys_id})`,
          `Table:    ${result.table || '—'}`,
          `Queue:    ${result.queue}${result.queue_registered ? '' : ' (not a custom queue)'}`,
          `Priority: ${result.priority || '100'}`,
          `Listeners (script actions): ${listeners.length}`,
          ...listeners.map(
            (l) =>
              `  • ${l.name}${l.active ? '' : ' (inactive)'} — order ${l.order || '100'} — ${l.sys_id}`,
          ),
          `URL:      ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
