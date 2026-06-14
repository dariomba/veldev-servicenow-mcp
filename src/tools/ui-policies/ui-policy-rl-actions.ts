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
import { UiPolicyRlActionCreate, UiPolicyRlActionUpdate } from './schemas.js';

const TABLE = 'sys_ui_policy_rl_action';

export function registerUiPolicyRlActionTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_form_ui_policy_rl_actions',
    {
      access: 'write',
      title: 'Create Form UI Policy Related List Actions',
      description: [
        'Creates one or more sys_ui_policy_rl_action records in a single call —',
        'each shows or hides a related list on a form when the parent UI Policy',
        'condition is met.',
        'Call after create_form_ui_policy, using the policy sys_id it returned.',
        '',
        'Related lists only support visibility (true / false / ignore) — there',
        'is no mandatory / read-only / value, unlike field actions.',
      ].join('\n'),
      inputSchema: {
        actions: z
          .array(UiPolicyRlActionCreate)
          .min(1)
          .describe('Related list actions to create.'),
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
              `"${a.ui_policy}" is not a valid sys_ui_policy sys_id (list: ${a.list}).`,
            );
          }
        }

        const created = await Promise.all(
          actions.map((a) =>
            client.createRecord<SnRecord>(TABLE, {
              ui_policy: a.ui_policy,
              list: a.list,
              visible: a.visible,
            }),
          ),
        );

        // ui_policy isn't persisted by the REST insert — re-link all at once.
        const links = created.map((r, i) => ({
          action: val(r, 'sys_id'),
          policy: actions[i].ui_policy,
        }));
        await relinkPolicies(client, TABLE, links);

        const lines = [
          `Form UI Policy related list actions created: ${created.length}`,
          '(ui_policy linked via background job, ~1s)',
          '',
          ...created.map((r, i) => {
            const a = actions[i];
            return `  • ${a.list}: visible=${a.visible} — ${val(r, 'sys_id')}`;
          }),
        ];
        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_form_ui_policy_rl_action',
    {
      access: 'write',
      title: 'Update Form UI Policy Related List Action',
      description: [
        'Updates fields on an existing sys_ui_policy_rl_action record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
      ].join('\n'),
      inputSchema: UiPolicyRlActionUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, ui_policy, list, visible }) => {
      try {
        const err = requireSysId(sys_id, 'sys_ui_policy_rl_action sys_id');
        if (err) return errText(err);

        const body: Record<string, unknown> = {};
        if (ui_policy !== undefined) body.ui_policy = ui_policy;
        if (list !== undefined) body.list = list;
        if (visible !== undefined) body.visible = visible;

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
            'Form UI Policy related list action updated successfully.',
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
