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
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  INBOUND_ACTION_FIELDS,
  InboundActionCreate,
  InboundActionGet,
  InboundActionList,
  InboundActionUpdate,
} from './schemas.js';

const TABLE = 'sysevent_in_email_action';

type InboundActionInput = Record<string, unknown>;

/** Builds the Table API body from the supplied (already-defaulted) input. */
function buildBody(input: InboundActionInput): InboundActionInput {
  const body: InboundActionInput = {};
  for (const f of INBOUND_ACTION_FIELDS) {
    const v = input[f];
    if (v === undefined) continue;
    // The Table API takes strings; booleans and the numeric order serialise.
    body[f] = typeof v === 'string' ? v : String(v);
  }
  return body;
}

/**
 * Type-specific guardrails shared by create and update. Returns the warning
 * lines to append to the result (empty when nothing to flag).
 */
function guardrails(input: InboundActionInput): string[] {
  const warnings: string[] = [];
  if (
    input.action === 'reply_email' &&
    (input.reply_email === undefined || input.reply_email === '')
  ) {
    warnings.push(
      'WARNING: action=reply_email but no reply_email body was set — the sender ' +
        'will receive an empty reply.',
    );
  }
  return warnings;
}

export function registerInboundActionTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_inbound_action',
    {
      access: 'write',
      title: 'Create Inbound Email Action',
      description: [
        'Creates a sysevent_in_email_action record — server-side logic that runs',
        'when ServiceNow receives an email.',
        '',
        'PROCESSING ORDER: incoming email is classified as New / Reply / Forward',
        '(by watermark / In-Reply-To). Only actions of the matching `type` run, in',
        'ascending `order` (lower first). filter_condition (encoded query) and',
        'condition_script (JS boolean) gate each one. stop_processing=true halts the',
        'chain so no higher-order action of the same type runs after it.',
        '',
        'TYPE drives what `current` is: type=new → a brand-new record of `table`',
        '(REQUIRED for new); type=reply/forward → the watermarked record (table',
        'usually empty). Inside `script` you also get `email`, `sys_email`, `event`,',
        '`logger`, `classifier`, and `gs`.',
        '',
        'Idempotent: an existing action with the same name+table is returned unchanged.',
      ].join('\n'),
      inputSchema: InboundActionCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { name, type, table } = input;

        if (type === 'new' && (table === undefined || table === '')) {
          return errText(
            'type=new requires a target `table` (the table the new `current` ' +
              'record belongs to). Set `table` to an internal table name, e.g. ' +
              "'incident'.",
          );
        }

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `name=${name}^table=${table ?? ''}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return textResult(
            [
              'Inbound email action already exists — skipped.',
              '',
              `name:   ${name}`,
              `table:  ${table || '(none)'}`,
              `sys_id: ${resolveValue(existing[0].sys_id)}`,
            ].join('\n'),
          );
        }

        const body = buildBody(input);
        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        const lines = [
          'Inbound email action created.',
          '',
          `name:            ${name}`,
          `type:            ${type}`,
          `action:          ${input.action}`,
          `table:           ${table || '(resolved from watermark)'}`,
          `order:           ${input.order ?? 100}`,
          `stop_processing: ${input.stop_processing === true}`,
          `sys_id:          ${sys_id}`,
          `URL:             ${recordUrl(client, TABLE, sys_id)}`,
        ];
        const warnings = guardrails(input);
        if (warnings.length) lines.push('', ...warnings);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_inbound_action',
    {
      access: 'write',
      title: 'Update Inbound Email Action',
      description: [
        'Updates fields on an existing sysevent_in_email_action record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
        '',
        'Reminder: type=new needs a target `table`; if you switch an action to',
        'type=new make sure `table` is set or the action has nowhere to create a',
        'record.',
      ].join('\n'),
      inputSchema: InboundActionUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const sys_id = input.sys_id as string;
        const idErr = requireSysId(sys_id, 'sysevent_in_email_action sys_id');
        if (idErr) return errText(idErr);

        const body = buildBody(input);
        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        const lines = [
          'Inbound email action updated successfully.',
          '',
          `sys_id:         ${sys_id}`,
          `Updated fields: ${Object.keys(body).join(', ')}`,
        ];
        // Only warn about table when the caller is actively setting type=new.
        if (
          input.type === 'new' &&
          (input.table === undefined || input.table === '')
        ) {
          lines.push(
            '',
            'WARNING: type set to new without a `table` — verify the action has a ' +
              'target table or it will have nowhere to create a record.',
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
    'list_inbound_actions',
    {
      access: 'read',
      title: 'List Inbound Email Actions',
      description: [
        'Lists sysevent_in_email_action records, optionally filtered by target',
        'table, type (new/reply/forward), name substring, or active flag.',
        'Ordered by type then order — the sequence in which they are evaluated.',
      ].join('\n'),
      inputSchema: InboundActionList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ table, type, name_contains, active, limit }) => {
      try {
        const clauses: string[] = [];
        if (table) clauses.push(`table=${table}`);
        if (type) clauses.push(`type=${type}`);
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        if (active !== undefined) clauses.push(`active=${String(active)}`);
        clauses.push('ORDERBYtype', 'ORDERBYorder');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'name',
            'type',
            'action',
            'table',
            'active',
            'order',
            'stop_processing',
          ],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const act = val(r, 'active') === 'true' ? '' : ' (inactive)';
                const stop =
                  val(r, 'stop_processing') === 'true' ? ' — stops' : '';
                const tbl = val(r, 'table') ? ` — ${val(r, 'table')}` : '';
                return (
                  `[${val(r, 'type')}] ${val(r, 'name')}${act}${tbl} ` +
                  `— order ${val(r, 'order') || '100'}${stop} — ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No inbound email actions matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_inbound_action',
    {
      access: 'read',
      title: 'Get Inbound Email Action',
      description: [
        'Reads a single sysevent_in_email_action record: its classification, target',
        'table, gating (filter_condition / condition_script), and server-side script.',
      ].join('\n'),
      inputSchema: InboundActionGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const idErr = requireSysId(sys_id, 'sysevent_in_email_action sys_id');
        if (idErr) return errText(idErr);

        const base = await client.getRecord<SnRecord>(TABLE, sys_id);

        const result = {
          sys_id: val(base, 'sys_id'),
          name: val(base, 'name'),
          type: val(base, 'type'),
          action: val(base, 'action'),
          table: val(base, 'table'),
          active: val(base, 'active') === 'true',
          order: val(base, 'order') || '100',
          stop_processing: val(base, 'stop_processing') === 'true',
          event_name: val(base, 'event_name'),
          from: disp(base, 'from'),
          required_roles: val(base, 'required_roles'),
          filter_condition: val(base, 'filter_condition'),
          condition_script: val(base, 'condition_script'),
          script: val(base, 'script'),
          reply_email: val(base, 'reply_email'),
          description: val(base, 'description'),
          url: recordUrl(client, TABLE, sys_id),
        };

        const summary = [
          `Inbound Email Action: ${result.name} (${result.sys_id})`,
          `Type:      ${result.type} · action=${result.action}${
            result.active ? '' : ' — INACTIVE'
          }`,
          `Target:    ${result.table || '(resolved from watermark)'}`,
          `Order:     ${result.order}${
            result.stop_processing ? ' · stops processing' : ''
          }`,
          `From:      ${result.from || '(any sender)'}`,
          `Filter:    ${result.filter_condition || '(none)'}`,
          `Condition: ${result.condition_script || '(none)'}`,
          `Script:    ${result.script ? `${result.script.length} chars` : '(none)'}`,
          `URL:       ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
