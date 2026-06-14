import { z } from 'zod';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord } from '../../types/servicenow.js';
import {
  errText,
  handleError,
  isSysId,
  requireSysId,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import { relinkPolicies } from './relink.js';
import { UiPolicyActionCreate, UiPolicyActionUpdate } from './schemas.js';

const TABLE = 'sys_ui_policy_action';
const POLICY_TABLE = 'sys_ui_policy';

/** mandatory + read-only on the same field is contradictory in ServiceNow. */
function mandatoryReadonlyConflict(
  mandatory: string | undefined,
  disabled: string | undefined,
): boolean {
  return mandatory === 'true' && disabled === 'true';
}

export function registerUiPolicyActionTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_form_ui_policy_actions',
    {
      access: 'write',
      title: 'Create Form UI Policy Actions',
      description: [
        'Creates one or more sys_ui_policy_action records in a single call —',
        'the per-field behaviour for a form UI Policy (visible / mandatory /',
        'read-only / set or clear value).',
        'Call after create_form_ui_policy, using the policy sys_id it returned.',
        '',
        "Each effect is a tri-state: 'true', 'false', or 'ignore' (leave alone).",
        "NEVER set mandatory='true' and disabled='true' on the same field.",
        '',
        'Omit `table` on an action to inherit it from its parent policy.',
      ].join('\n'),
      inputSchema: {
        actions: z
          .array(UiPolicyActionCreate)
          .min(1)
          .describe('Field actions to create.'),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ actions }) => {
      try {
        for (const a of actions) {
          if (!isSysId(a.ui_policy)) {
            return errText(
              `"${a.ui_policy}" is not a valid sys_ui_policy sys_id (field: ${a.field}).`,
            );
          }
          if (mandatoryReadonlyConflict(a.mandatory, a.disabled)) {
            return errText(
              `mandatory and disabled cannot both be 'true' on the same field (field: ${a.field}).`,
            );
          }
          if (a.value_action === 'set_value' && !a.value) {
            return errText(
              `value is required when value_action='set_value' (field: ${a.field}).`,
            );
          }
          if (a.field_message_type !== 'none' && !a.field_message) {
            return errText(
              `field_message is required when field_message_type isn't 'none' (field: ${a.field}).`,
            );
          }
        }

        // Resolve the table for actions that omit it — the field type on
        // sys_ui_policy_action.table normally derives from current.ui_policy.
        // table, which the REST default may not evaluate. Dedupe the lookups
        // by parent policy.
        const policiesToResolve = [
          ...new Set(
            actions
              .filter((a) => a.table === undefined)
              .map((a) => a.ui_policy),
          ),
        ];
        const resolved = await Promise.all(
          policiesToResolve.map((p) =>
            client.getRecord<SnRecord>(POLICY_TABLE, p, ['table']),
          ),
        );
        const tableByPolicy = new Map<string, string>();
        policiesToResolve.forEach((p, i) => {
          tableByPolicy.set(p, val(resolved[i], 'table'));
        });

        const created = await Promise.all(
          actions.map((a) => {
            const body: Record<string, unknown> = {
              ui_policy: a.ui_policy,
              field: a.field,
              table: a.table ?? tableByPolicy.get(a.ui_policy) ?? '',
              visible: a.visible,
              mandatory: a.mandatory,
              disabled: a.disabled,
              value_action: a.value_action,
              field_message_type: a.field_message_type,
            };
            if (a.value_action === 'set_value') body.value = a.value;
            if (a.field_message_type !== 'none')
              body.field_message = a.field_message;
            return client.createRecord<SnRecord>(TABLE, body);
          }),
        );

        // ui_policy isn't persisted by the REST insert — re-link all at once.
        const links = created.map((r, i) => ({
          action: val(r, 'sys_id'),
          policy: actions[i].ui_policy,
        }));
        await relinkPolicies(client, TABLE, links);

        const lines = [
          `Form UI Policy actions created: ${created.length}`,
          '(ui_policy linked via background job, ~1s)',
          '',
          ...created.map((r, i) => {
            const a = actions[i];
            return (
              `  • ${a.field}: visible=${a.visible}, mandatory=${a.mandatory}, ` +
              `read_only=${a.disabled}, value_action=${a.value_action} — ${val(r, 'sys_id')}`
            );
          }),
        ];
        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_form_ui_policy_action',
    {
      access: 'write',
      title: 'Update Form UI Policy Action',
      description: [
        'Updates fields on an existing sys_ui_policy_action record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
        '',
        "NEVER set mandatory='true' and disabled='true' on the same field.",
      ].join('\n'),
      inputSchema: UiPolicyActionUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      ui_policy,
      field,
      table,
      visible,
      mandatory,
      disabled,
      value_action,
      value,
      field_message_type,
      field_message,
    }) => {
      try {
        const err = requireSysId(sys_id, 'sys_ui_policy_action sys_id');
        if (err) return errText(err);
        if (mandatoryReadonlyConflict(mandatory, disabled)) {
          return errText(
            "mandatory and disabled cannot both be 'true' on the same field.",
          );
        }
        if (value_action === 'set_value' && !value) {
          return errText("value is required when value_action='set_value'.");
        }
        if (
          field_message_type !== undefined &&
          field_message_type !== 'none' &&
          !field_message
        ) {
          return errText(
            "field_message is required when field_message_type isn't 'none'.",
          );
        }

        const body: Record<string, unknown> = {};
        if (ui_policy !== undefined) body.ui_policy = ui_policy;
        if (field !== undefined) body.field = field;
        if (table !== undefined) body.table = table;
        if (visible !== undefined) body.visible = visible;
        if (mandatory !== undefined) body.mandatory = mandatory;
        if (disabled !== undefined) body.disabled = disabled;
        if (value_action !== undefined) body.value_action = value_action;
        if (value_action === 'set_value') body.value = value;
        if (field_message_type !== undefined)
          body.field_message_type = field_message_type;
        if (field_message_type !== undefined && field_message_type !== 'none')
          body.field_message = field_message;

        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        // ui_policy isn't persisted by the REST patch either — re-link it
        // server-side when the caller is reassigning the parent policy.
        if (ui_policy !== undefined) {
          await relinkPolicies(client, TABLE, [
            { action: sys_id, policy: ui_policy },
          ]);
        }

        return textResult(
          [
            'Form UI Policy action updated successfully.',
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
}
