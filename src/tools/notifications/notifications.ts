import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord, SnReference } from '../../types/servicenow.js';
import {
  disp,
  errText,
  handleError,
  recordUrl,
  requireSysId,
  resolveValue,
  richResult,
  serializeFields,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  NOTIFICATION_FIELDS,
  NotificationCreate,
  NotificationGet,
  NotificationList,
  NotificationUpdate,
} from './schemas.js';

const TABLE = 'sysevent_email_action';

type NotificationInput = Record<string, unknown>;

const MAIL_SCRIPT_RE = /\$\{mail_script:([^}]+)\}/g;

/** Unique sys_script_email names referenced via ${mail_script:<name>} in a body. */
function mailScriptRefs(...bodies: string[]): string[] {
  const names = new Set<string>();
  for (const body of bodies) {
    for (const m of body.matchAll(MAIL_SCRIPT_RE)) {
      const name = m[1].trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/**
 * Create-time guardrails: a notification with full known state (defaults
 * applied) that would never fire or reach no one. Returns warning lines to
 * append (empty when nothing to flag).
 */
function guardrails(input: NotificationInput): string[] {
  const warnings: string[] = [];
  const gen = (input.generation_type as string) ?? 'engine';

  if (
    gen === 'engine' &&
    input.action_insert !== true &&
    input.action_update !== true
  ) {
    warnings.push(
      'WARNING: generation_type=engine but neither action_insert nor ' +
        'action_update is set — this notification will never fire. Enable at ' +
        'least one, or switch to an event/triggered notification.',
    );
  }
  if (gen === 'event' && !input.event_name) {
    warnings.push(
      'WARNING: generation_type=event but no event_name is set — this ' +
        'notification will never fire. Set the system event that triggers it.',
    );
  }

  const hasRecipient =
    !!input.recipient_users ||
    !!input.recipient_groups ||
    !!input.recipient_fields ||
    input.send_self === true ||
    input.event_parm_1 === true ||
    input.event_parm_2 === true;
  if (!hasRecipient) {
    warnings.push(
      'WARNING: no recipient source set (no recipient_users, recipient_groups, ' +
        'recipient_fields, send_self, or event parm) — this notification would ' +
        'send to nobody.',
    );
  }

  return warnings;
}

export function registerNotificationTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_notification',
    {
      access: 'write',
      title: 'Create Email Notification',
      description: [
        'Creates a sysevent_email_action record — an OUTBOUND email rule that',
        'sends mail when something happens to a record. (Inbound counterpart:',
        'create_inbound_action.)',
        '',
        'WHEN it sends — generation_type:',
        '• engine — Record inserted or updated: fires on writes to `collection`,',
        '  gated by action_insert/action_update and `condition` (encoded query) /',
        '  `advanced_condition` (server-side JS). `collection` is REQUIRED here.',
        '• event — fires when system `event_name` is pushed to the event queue.',
        '• triggered — sent explicitly from Flow Designer / notification scripts.',
        '',
        'WHO receives it is the UNION of recipient_users, recipient_groups,',
        'recipient_fields (user/group fields on the record), send_self, and event',
        'parm recipients.',
        '',
        'WHAT it sends — `subject` + `message_html`. Both resolve ${field} and',
        '${mail_script:<name>} substitutions; ${mail_script:<name>} embeds a',
        'sys_script_email record (create_email_script).',
        '',
        'WEIGHT de-dupes notifications firing together for the same record+recipient:',
        'among non-zero weights only the highest sends; weight 0 (default) always sends.',
        '',
        'Idempotent: an existing notification with the same name+collection is returned unchanged.',
      ].join('\n'),
      inputSchema: NotificationCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { name, collection, generation_type } = input;

        if (generation_type === 'engine' && !collection) {
          return errText(
            'generation_type=engine requires a `collection` (the table whose ' +
              'inserts/updates trigger the notification). Set `collection` to an ' +
              "internal table name, e.g. 'incident'.",
          );
        }

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `name=${name}^collection=${collection ?? ''}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return textResult(
            [
              'Email notification already exists — skipped.',
              '',
              `name:       ${name}`,
              `collection: ${collection || '(none)'}`,
              `sys_id:     ${resolveValue(existing[0].sys_id)}`,
            ].join('\n'),
          );
        }

        const body = serializeFields(input, NOTIFICATION_FIELDS);
        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        const lines = [
          'Email notification created.',
          '',
          `name:            ${name}`,
          `collection:      ${collection || '(none)'}`,
          `generation_type: ${generation_type}`,
          `triggers:        ${triggerSummary(input)}`,
          `recipients:      ${recipientSummary(input)}`,
          `weight:          ${input.weight ?? 0}`,
          `sys_id:          ${sys_id}`,
          `URL:             ${recordUrl(client, TABLE, sys_id)}`,
        ];

        const refs = mailScriptRefs(
          (input.message_html as string) ?? '',
          (input.subject as string) ?? '',
        );
        if (refs.length) {
          lines.push(
            '',
            `References email scripts (${refs.join(', ')}) — ensure each ` +
              'sys_script_email exists (create_email_script).',
          );
        }

        const warnings = guardrails(input);
        if (warnings.length) lines.push('', ...warnings);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_notification',
    {
      access: 'write',
      title: 'Update Email Notification',
      description: [
        'Updates fields on an existing sysevent_email_action record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
        '',
        'Reminder: an engine notification needs action_insert/action_update set,',
        'an event notification needs event_name, and at least one recipient source',
        'must be present or it sends to nobody.',
      ].join('\n'),
      inputSchema: NotificationUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const sys_id = input.sys_id as string;
        const idErr = requireSysId(sys_id, 'sysevent_email_action sys_id');
        if (idErr) return errText(idErr);

        const body = serializeFields(input, NOTIFICATION_FIELDS);
        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        const lines = [
          'Email notification updated successfully.',
          '',
          `sys_id:         ${sys_id}`,
          `Updated fields: ${Object.keys(body).join(', ')}`,
        ];

        const refs = mailScriptRefs(
          (input.message_html as string) ?? '',
          (input.subject as string) ?? '',
        );
        if (refs.length) {
          lines.push(
            '',
            `References email scripts (${refs.join(', ')}) — ensure each ` +
              'sys_script_email exists (create_email_script).',
          );
        }

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_notifications',
    {
      access: 'read',
      title: 'List Email Notifications',
      description: [
        'Lists sysevent_email_action records, optionally filtered by target table',
        '(collection), generation_type (engine/event/triggered), name substring, or',
        'active flag. Ordered by collection then name.',
      ].join('\n'),
      inputSchema: NotificationList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ collection, generation_type, name_contains, active, limit }) => {
      try {
        const clauses: string[] = [];
        if (collection) clauses.push(`collection=${collection}`);
        if (generation_type) clauses.push(`generation_type=${generation_type}`);
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        if (active !== undefined) clauses.push(`active=${String(active)}`);
        clauses.push('ORDERBYcollection', 'ORDERBYname');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'name',
            'collection',
            'generation_type',
            'event_name',
            'action_insert',
            'action_update',
            'active',
            'weight',
          ],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const act = val(r, 'active') === 'true' ? '' : ' (inactive)';
                const tbl = val(r, 'collection')
                  ? ` — ${val(r, 'collection')}`
                  : '';
                const trig = listTrigger(r);
                const wt = val(r, 'weight');
                const weight = wt && wt !== '0' ? ` — weight ${wt}` : '';
                return (
                  `[${val(r, 'generation_type') || 'engine'}] ${val(r, 'name')}` +
                  `${act}${tbl} — ${trig}${weight} — ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No email notifications matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_notification',
    {
      access: 'read',
      title: 'Get Email Notification',
      description: [
        'Reads a single sysevent_email_action record: its trigger (generation_type,',
        'insert/update, condition / advanced_condition, event_name), recipients,',
        'subject/body, and delivery settings. Also lists the email scripts the body',
        'references via ${mail_script:<name>}.',
      ].join('\n'),
      inputSchema: NotificationGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const idErr = requireSysId(sys_id, 'sysevent_email_action sys_id');
        if (idErr) return errText(idErr);

        const base = await client.getRecord<SnRecord>(TABLE, sys_id);
        const message_html = val(base, 'message_html');
        const subject = val(base, 'subject');

        const result = {
          sys_id: val(base, 'sys_id'),
          name: val(base, 'name'),
          collection: val(base, 'collection'),
          active: val(base, 'active') === 'true',
          generation_type: val(base, 'generation_type') || 'engine',
          action_insert: val(base, 'action_insert') === 'true',
          action_update: val(base, 'action_update') === 'true',
          condition: val(base, 'condition'),
          advanced_condition: val(base, 'advanced_condition'),
          event_name: val(base, 'event_name'),
          recipient_users: disp(base, 'recipient_users'),
          recipient_groups: disp(base, 'recipient_groups'),
          recipient_fields: val(base, 'recipient_fields'),
          send_self: val(base, 'send_self') === 'true',
          event_parm_1: val(base, 'event_parm_1') === 'true',
          event_parm_2: val(base, 'event_parm_2') === 'true',
          subscribable: val(base, 'subscribable') === 'true',
          subject,
          content_type: val(base, 'content_type'),
          template: disp(base, 'template'),
          weight: val(base, 'weight') || '0',
          importance: val(base, 'importance'),
          mandatory: val(base, 'mandatory') === 'true',
          category: disp(base, 'category'),
          digestable: val(base, 'digestable') === 'true',
          omit_watermark: val(base, 'omit_watermark') === 'true',
          message_html,
          mail_script_refs: mailScriptRefs(message_html, subject),
          description: val(base, 'description'),
          url: recordUrl(client, TABLE, sys_id),
        };

        const summary = [
          `Email Notification: ${result.name} (${result.sys_id})`,
          `Table:      ${result.collection || '(none)'}${
            result.active ? '' : ' — INACTIVE'
          }`,
          `Trigger:    ${triggerSummary(result)}`,
          `Condition:  ${result.condition || '(none)'}`,
          `Advanced:   ${result.advanced_condition ? 'yes (script)' : '(none)'}`,
          `Recipients: ${recipientSummary(result)}`,
          `Subject:    ${result.subject || '(none)'}`,
          `Body:       ${
            result.message_html
              ? `${result.message_html.length} chars`
              : '(none)'
          }`,
          `Weight:     ${result.weight}${
            result.omit_watermark ? ' · watermark omitted' : ''
          }`,
          `Mail scripts: ${
            result.mail_script_refs.length
              ? result.mail_script_refs.join(', ')
              : '(none)'
          }`,
          `URL:        ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}

/** One-line trigger description from a tool input or a get() result object. */
function triggerSummary(r: {
  generation_type?: string;
  action_insert?: unknown;
  action_update?: unknown;
  event_name?: string;
}): string {
  const gen = r.generation_type ?? 'engine';
  if (gen === 'engine') {
    const ops: string[] = [];
    if (r.action_insert === true) ops.push('insert');
    if (r.action_update === true) ops.push('update');
    return ops.length
      ? `on ${ops.join(' / ')}`
      : 'engine — no insert/update set';
  }
  if (gen === 'event') {
    return r.event_name ? `event ${r.event_name}` : 'event — no event_name set';
  }
  return 'triggered (Flow/script)';
}

/** Trigger summary from a raw list row (string-valued reference fields). */
function listTrigger(r: SnRecord): string {
  const gen = val(r, 'generation_type') || 'engine';
  if (gen === 'event') return `event ${val(r, 'event_name') || '(unset)'}`;
  if (gen === 'triggered') return 'triggered';
  const ops: string[] = [];
  if (val(r, 'action_insert') === 'true') ops.push('insert');
  if (val(r, 'action_update') === 'true') ops.push('update');
  return ops.length ? `on ${ops.join('/')}` : 'no insert/update';
}

/** One-line recipient description from a tool input or a get() result object. */
function recipientSummary(r: {
  recipient_users?: unknown;
  recipient_groups?: unknown;
  recipient_fields?: unknown;
  send_self?: unknown;
  event_parm_1?: unknown;
  event_parm_2?: unknown;
}): string {
  const sources: string[] = [];
  if (r.recipient_users) sources.push('users');
  if (r.recipient_groups) sources.push('groups');
  if (r.recipient_fields) sources.push('record fields');
  if (r.send_self === true) sources.push('event creator');
  if (r.event_parm_1 === true) sources.push('event parm1');
  if (r.event_parm_2 === true) sources.push('event parm2');
  return sources.length ? sources.join(', ') : '(none — sends to nobody)';
}
