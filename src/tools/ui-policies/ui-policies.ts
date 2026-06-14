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
  UI_TYPE_CODE,
  UiPolicyCreate,
  UiPolicyGet,
  UiPolicyList,
  UiPolicyUpdate,
} from './schemas.js';

const TABLE = 'sys_ui_policy';
const ACTION_TABLE = 'sys_ui_policy_action';
const RL_ACTION_TABLE = 'sys_ui_policy_rl_action';

/** Reverse of UI_TYPE_CODE — choice code → friendly label, for read output. */
const UI_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(UI_TYPE_CODE).map(([label, code]) => [code, label]),
);

export function registerUiPolicyTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_form_ui_policy',
    {
      access: 'write',
      title: 'Create Form UI Policy',
      description: [
        'Creates a sys_ui_policy record — a UI Policy that runs on a table form.',
        '(For catalog item forms use the catalog batch_create_ui_policies tool.)',
        '',
        'A policy on its own does nothing visible — attach field behaviour with',
        'create_form_ui_policy_action using the sys_id returned here.',
        '',
        'Keep reverse_if_false=true unless the actions should persist after the',
        'condition stops matching. Lower `order` wins on conflicting fields.',
      ].join('\n'),
      inputSchema: UiPolicyCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      short_description,
      table,
      conditions,
      active,
      on_load,
      reverse_if_false,
      run_scripts,
      global,
      inherit,
      order,
      ui_type,
      view,
      description,
      script_true,
      script_false,
      isolate_script,
    }) => {
      try {
        const body: Record<string, unknown> = {
          short_description,
          table,
          active: String(active),
          on_load: String(on_load),
          reverse_if_false: String(reverse_if_false),
          run_scripts: String(run_scripts),
          global: String(global),
          inherit: String(inherit),
          order: String(order),
          ui_type: UI_TYPE_CODE[ui_type],
        };
        if (conditions !== undefined) body.conditions = conditions;
        // view only applies to a single-view (non-global) policy.
        if (view !== undefined && !global) body.view = view;
        if (description !== undefined) body.description = description;
        if (script_true !== undefined) body.script_true = script_true;
        if (script_false !== undefined) body.script_false = script_false;
        if (isolate_script !== undefined)
          body.isolate_script = String(isolate_script);

        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        return textResult(
          [
            'Form UI Policy created.',
            '',
            `short_description: ${short_description}`,
            `table:             ${table}`,
            `conditions:        ${conditions || '(always)'}`,
            `order:             ${order}`,
            `sys_id:            ${sys_id}`,
            `URL:               ${recordUrl(client, TABLE, sys_id)}`,
            '',
            'Next: create_form_ui_policy_action to attach per-field behaviour.',
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_form_ui_policy',
    {
      access: 'write',
      title: 'Update Form UI Policy',
      description: [
        'Updates fields on an existing sys_ui_policy record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
      ].join('\n'),
      inputSchema: UiPolicyUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      short_description,
      table,
      conditions,
      active,
      on_load,
      reverse_if_false,
      run_scripts,
      global,
      inherit,
      order,
      ui_type,
      view,
      description,
      script_true,
      script_false,
      isolate_script,
    }) => {
      try {
        const err = requireSysId(sys_id, 'sys_ui_policy sys_id');
        if (err) return errText(err);

        const body: Record<string, unknown> = {};
        if (short_description !== undefined)
          body.short_description = short_description;
        if (table !== undefined) body.table = table;
        if (conditions !== undefined) body.conditions = conditions;
        if (active !== undefined) body.active = String(active);
        if (on_load !== undefined) body.on_load = String(on_load);
        if (reverse_if_false !== undefined)
          body.reverse_if_false = String(reverse_if_false);
        if (run_scripts !== undefined) body.run_scripts = String(run_scripts);
        if (global !== undefined) body.global = String(global);
        if (inherit !== undefined) body.inherit = String(inherit);
        if (order !== undefined) body.order = String(order);
        if (ui_type !== undefined) body.ui_type = UI_TYPE_CODE[ui_type];
        if (view !== undefined) body.view = view;
        if (description !== undefined) body.description = description;
        if (script_true !== undefined) body.script_true = script_true;
        if (script_false !== undefined) body.script_false = script_false;
        if (isolate_script !== undefined)
          body.isolate_script = String(isolate_script);

        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);
        return textResult(
          [
            'Form UI Policy updated successfully.',
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
    'list_form_ui_policies',
    {
      access: 'read',
      title: 'List Form UI Policies',
      description: [
        'Lists sys_ui_policy records, optionally filtered by table, short',
        'description substring, or active flag. Ordered by table then order.',
      ].join('\n'),
      inputSchema: UiPolicyList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ table, short_description_contains, active, limit }) => {
      try {
        const clauses: string[] = [];
        if (table) clauses.push(`table=${table}`);
        if (short_description_contains)
          clauses.push(`short_descriptionLIKE${short_description_contains}`);
        if (active !== undefined) clauses.push(`active=${String(active)}`);
        clauses.push('ORDERBYtable', 'ORDERBYorder');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'short_description',
            'table',
            'active',
            'on_load',
            'order',
            'conditions',
          ],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const act = val(r, 'active') === 'true' ? '' : ' (inactive)';
                return (
                  `${disp(r, 'table')} — ${val(r, 'short_description')}${act} ` +
                  `— order ${val(r, 'order') || '100'} — ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No UI policies matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_form_ui_policy',
    {
      access: 'read',
      title: 'Get Form UI Policy',
      description: [
        'Reads a single sys_ui_policy record together with all of its UI policy',
        'actions (the per-field visible / mandatory / read-only behaviour).',
      ].join('\n'),
      inputSchema: UiPolicyGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const err = requireSysId(sys_id, 'sys_ui_policy sys_id');
        if (err) return errText(err);

        // Independent reads — the action queries key off the input sys_id, not
        // the policy record — so fetch all three in parallel.
        const [base, actions, rlActions] = await Promise.all([
          client.getRecord<SnRecord>(TABLE, sys_id, [
            'sys_id',
            'short_description',
            'table',
            'conditions',
            'active',
            'on_load',
            'reverse_if_false',
            'run_scripts',
            'global',
            'inherit',
            'order',
            'ui_type',
            'view',
            'description',
          ]),
          client.listRecords<SnRecord>(
            ACTION_TABLE,
            `ui_policy=${sys_id}^ORDERBYfield`,
            [
              'sys_id',
              'field',
              'visible',
              'mandatory',
              'disabled',
              'value_action',
              'value',
              'field_message_type',
              'field_message',
            ],
            100,
          ),
          client.listRecords<SnRecord>(
            RL_ACTION_TABLE,
            `ui_policy=${sys_id}^ORDERBYlist`,
            ['sys_id', 'list', 'visible'],
            100,
          ),
        ]);

        const policyActions = actions.map((a) => ({
          sys_id: val(a, 'sys_id'),
          field: val(a, 'field'),
          visible: val(a, 'visible'),
          mandatory: val(a, 'mandatory'),
          read_only: val(a, 'disabled'),
          value_action: val(a, 'value_action'),
          value: val(a, 'value'),
          field_message_type: val(a, 'field_message_type'),
          field_message: val(a, 'field_message'),
        }));

        const relatedListActions = rlActions.map((a) => ({
          sys_id: val(a, 'sys_id'),
          list: val(a, 'list'),
          visible: val(a, 'visible'),
        }));

        const uiTypeCode = val(base, 'ui_type');
        const result = {
          sys_id: val(base, 'sys_id'),
          short_description: val(base, 'short_description'),
          table: disp(base, 'table'),
          conditions: val(base, 'conditions'),
          active: val(base, 'active') === 'true',
          on_load: val(base, 'on_load') === 'true',
          reverse_if_false: val(base, 'reverse_if_false') === 'true',
          run_scripts: val(base, 'run_scripts') === 'true',
          global: val(base, 'global') === 'true',
          inherit: val(base, 'inherit') === 'true',
          order: val(base, 'order') || '100',
          ui_type: UI_TYPE_LABEL[uiTypeCode] ?? uiTypeCode,
          view: disp(base, 'view'),
          description: val(base, 'description'),
          url: recordUrl(client, TABLE, sys_id),
          actions: policyActions,
          related_list_actions: relatedListActions,
        };

        const summary = [
          `UI Policy: ${result.short_description} (${result.sys_id})`,
          `Table:     ${result.table}${result.active ? '' : ' — INACTIVE'}`,
          `Condition: ${result.conditions || '(always — on_load)'}`,
          `Options:   order ${result.order} · ui_type ${result.ui_type} · ` +
            `reverse_if_false ${result.reverse_if_false} · run_scripts ${result.run_scripts}`,
          `Actions (${policyActions.length}):`,
          ...policyActions.map((a) => {
            const parts = [
              `visible=${a.visible}`,
              `mandatory=${a.mandatory}`,
              `read_only=${a.read_only}`,
            ];
            if (a.value_action !== 'ignore') {
              parts.push(
                a.value_action === 'set_value'
                  ? `set_value="${a.value}"`
                  : a.value_action,
              );
            }
            return `  • ${a.field}: ${parts.join(', ')}`;
          }),
          `Related list actions (${relatedListActions.length}):`,
          ...relatedListActions.map(
            (a) => `  • ${a.list}: visible=${a.visible}`,
          ),
          `URL:       ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
