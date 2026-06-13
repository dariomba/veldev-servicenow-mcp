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
  ScriptActionCreate,
  ScriptActionList,
  ScriptActionUpdate,
} from './schemas.js';

const TABLE = 'sysevent_script_action';

type SnRecord = Record<string, SnReference | undefined>;

const val = (r: SnRecord, f: string): string =>
  r[f] ? resolveValue(r[f] as SnReference) : '';
const disp = (r: SnRecord, f: string): string =>
  r[f] ? resolveDisplay(r[f] as SnReference) : '';

function recordUrl(client: ServiceNowClient, sysId: string): string {
  return `${client.getInstanceUrl()}/${TABLE}.do?sys_id=${sysId}`;
}

export function registerScriptActionTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_script_action',
    {
      access: 'write',
      title: 'Create Script Action',
      description: [
        'Creates a script action (sysevent_script_action) — server-side JavaScript that',
        'runs whenever a registered event is processed.',
        '',
        'event_name must match a registered event (sysevent_register). In the script the',
        'fired event is the global `event` (event.parm1/parm2, event.instance = the',
        'triggering record sys_id) and the related record is `current` when the event was',
        'fired with one.',
        '',
        'IMPORTANT: `event` and `current` are NOT available in condition_script — put all',
        'record-based conditions inside the script body, not the condition.',
        '',
        'Idempotent: if a script action with the same name on the same event already',
        'exists, its sys_id is returned and no new record is created.',
      ].join('\n'),
      inputSchema: ScriptActionCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      name,
      event_name,
      script,
      condition_script,
      order,
      synchronous,
      active,
      description,
    }) => {
      try {
        const existing = await client.listRecords<SnRecord>(
          TABLE,
          `name=${name}^event_name=${event_name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Script action "${name}" on event "${event_name}" already exists — skipped.`,
                  `sys_id: ${val(existing[0], 'sys_id')}`,
                ].join('\n'),
              },
            ],
          };
        }

        const body: Record<string, unknown> = {
          name,
          event_name,
          script,
          active: String(active),
          synchronous: String(synchronous),
        };
        if (condition_script !== undefined)
          body.condition_script = condition_script;
        if (order !== undefined) body.order = String(order);
        if (description !== undefined) body.description = description;

        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Script action created.',
                '',
                `name:        ${name}`,
                `event_name:  ${event_name}`,
                `synchronous: ${synchronous}`,
                `active:      ${active}`,
                `sys_id:      ${sys_id}`,
                `URL:         ${recordUrl(client, sys_id)}`,
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
    'update_script_action',
    {
      access: 'write',
      title: 'Update Script Action',
      description: [
        'Updates fields on an existing sysevent_script_action record.',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
      ].join('\n'),
      inputSchema: ScriptActionUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      event_name,
      script,
      condition_script,
      order,
      synchronous,
      active,
      description,
    }) => {
      try {
        if (!isSysId(sys_id))
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid sysevent_script_action sys_id.`,
              },
            ],
            isError: true,
          };

        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (event_name !== undefined) body.event_name = event_name;
        if (script !== undefined) body.script = script;
        if (condition_script !== undefined)
          body.condition_script = condition_script;
        if (order !== undefined) body.order = String(order);
        if (synchronous !== undefined) body.synchronous = String(synchronous);
        if (active !== undefined) body.active = String(active);
        if (description !== undefined) body.description = description;

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
                'Script action updated successfully.',
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
    'list_script_actions',
    {
      access: 'read',
      title: 'List Script Actions',
      description: [
        'Lists script actions (sysevent_script_action), optionally filtered by the event',
        'they listen on, name substring, or active state.',
      ].join('\n'),
      inputSchema: ScriptActionList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ event_name, name_contains, active_only, limit }) => {
      try {
        const clauses: string[] = [];
        if (event_name) clauses.push(`event_name=${event_name}`);
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        if (active_only) clauses.push('active=true');
        clauses.push('ORDERBYevent_name');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          ['sys_id', 'name', 'event_name', 'active', 'order', 'synchronous'],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const active = val(r, 'active') === 'true';
                const sync =
                  val(r, 'synchronous') === 'true' ? 'sync' : 'async';
                return `${disp(r, 'name')} — on ${val(r, 'event_name')} — ${sync}${active ? '' : ' (inactive)'} — ${val(r, 'sys_id')}`;
              })
              .join('\n')
          : 'No script actions matched.';

        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
