import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServiceNowClient } from '../clients/servicenow.js';
import type { SnReference } from '../types/servicenow.js';
import { handleError, isSysId, resolveValue } from './helpers.js';
import {
  UiPolicyActionCreate,
  UiPolicyActionUpdate,
  UiPolicyCreate,
  UiPolicyUpdate,
} from './schemas.js';

export function registerUiPolicyTools(
  server: McpServer,
  client: ServiceNowClient,
): void {
  server.registerTool(
    'batch_create_ui_policies',
    {
      title: 'Batch Create UI Policies',
      description: [
        'Creates multiple catalog_ui_policy records in a single call.',
        '',
        'CATALOG_CONDITIONS FORMAT:',
        '  Single value:  IO:<variable_sys_id>=<value>^EQ',
        '  AND:           IO:<id1>=<v1>^IO:<id2>=<v2>^EQ',
        '  OR:            IO:<id>=<v1>^ORIO:<id>=<v2>^EQ',
        '',
        'YES/NO variables (type=1): use =Yes or =No — never =true/false/1/0.',
        '',
        'Always set reverse_if_false=true unless explicitly stated otherwise.',
        'Returns sys_id of each created policy — required by batch_create_ui_policy_actions.',
      ].join('\n'),
      inputSchema: {
        policies: z
          .array(UiPolicyCreate)
          .min(1)
          .describe('Array of UI policy definitions to create.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ policies }) => {
      try {
        for (const p of policies) {
          if (p.applies_to === 'item') {
            if (!p.catalog_item) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `catalog_item is required for policy "${p.short_description}" when applies_to='item'.`,
                  },
                ],
                isError: true,
              };
            }
            if (!isSysId(p.catalog_item)) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `"${p.catalog_item}" is not a valid catalog item sys_id (policy: "${p.short_description}").`,
                  },
                ],
                isError: true,
              };
            }
          }
        }

        // Parallel creates for all policies
        const createdRecords = await Promise.all(
          policies.map((p) => {
            const body: Record<string, unknown> = {
              short_description: p.short_description,
              applies_to: p.applies_to,
              active: String(p.active),
              on_load: String(p.on_load),
              reverse_if_false: String(p.reverse_if_false),
              run_scripts: String(p.run_scripts),
              applies_catalog: String(p.applies_catalog),
              applies_req_item: String(p.applies_req_item),
              applies_sc_task: String(p.applies_sc_task),
            };
            if (p.catalog_item !== undefined)
              body.catalog_item = p.catalog_item;
            if (p.catalog_conditions !== undefined)
              body.catalog_conditions = p.catalog_conditions;

            return client.createRecord<{ sys_id: SnReference }>(
              'catalog_ui_policy',
              body,
            );
          }),
        );

        const createdSummary = createdRecords.map((record, i) => ({
          short_description: policies[i].short_description,
          sys_id: resolveValue(record.sys_id),
        }));

        const lines: string[] = [
          `UI Policies created: ${createdSummary.length}`,
          ``,
        ];
        createdSummary.forEach((p, idx) => {
          lines.push(
            `  ${idx + 1}. "${p.short_description}"  sys_id: ${p.sys_id}`,
          );
        });
        lines.push(
          ``,
          `Pass these sys_ids to batch_create_ui_policy_actions to attach per-variable actions.`,
        );

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    'batch_create_ui_policy_actions',
    {
      title: 'Batch Create UI Policy Actions',
      description: [
        'Creates multiple catalog_ui_policy_action records in a single call.',
        'Call this after batch_create_ui_policies, using the sys_ids it returned.',
        '',
        'CATALOG_VARIABLE FORMAT: IO:<variable_sys_id>',
        '',
        "NEVER set mandatory='true' and disabled='true' on the same action.",
        "Use 'ignore' for any effect that should not change.",
        "YES/NO set_value: value must be 'Yes' or 'No' — not a boolean.",
        '',
        'Idempotent per action: skips if ui_policy + catalog_variable already exists.',
      ].join('\n'),
      inputSchema: {
        actions: z
          .array(UiPolicyActionCreate)
          .min(1)
          .describe('Array of UI policy action definitions to create.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ actions }) => {
      try {
        // Validate inputs upfront
        for (const a of actions) {
          if (!isSysId(a.ui_policy)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `"${a.ui_policy}" is not a valid UI Policy sys_id (variable: ${a.catalog_variable}).`,
                },
              ],
              isError: true,
            };
          }
          if (!isSysId(a.catalog_item)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `"${a.catalog_item}" is not a valid catalog item sys_id (variable: ${a.catalog_variable}).`,
                },
              ],
              isError: true,
            };
          }
          if (a.mandatory === 'true' && a.disabled === 'true') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `mandatory and disabled cannot both be 'true' on the same action (variable: ${a.catalog_variable}).`,
                },
              ],
              isError: true,
            };
          }
          if (a.value_action === 'set_value' && !a.value) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `value is required when value_action='set_value' (variable: ${a.catalog_variable}).`,
                },
              ],
              isError: true,
            };
          }
          if (a.field_message_type !== 'none' && !a.field_message) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `field_message is required when field_message_type is not 'none' (variable: ${a.catalog_variable}).`,
                },
              ],
              isError: true,
            };
          }
        }

        // Parallel idempotency checks
        const existingChecks = await Promise.all(
          actions.map((a) =>
            client.listRecords<{ sys_id: SnReference }>(
              'catalog_ui_policy_action',
              `ui_policy=${a.ui_policy}^catalog_variable=${a.catalog_variable}`,
              ['sys_id'],
              1,
            ),
          ),
        );

        const toCreate: typeof actions = [];
        const skipped: Array<{
          catalog_variable: string;
          ui_policy: string;
          sys_id: string;
        }> = [];

        actions.forEach((a, i) => {
          if (existingChecks[i].length > 0) {
            skipped.push({
              catalog_variable: a.catalog_variable,
              ui_policy: a.ui_policy,
              sys_id: resolveValue(existingChecks[i][0].sys_id),
            });
          } else {
            toCreate.push(a);
          }
        });

        // Parallel creates for all new actions
        const createdRecords = await Promise.all(
          toCreate.map((a) => {
            const body: Record<string, unknown> = {
              ui_policy: a.ui_policy,
              catalog_item: a.catalog_item,
              catalog_variable: a.catalog_variable,
              visible: a.visible,
              mandatory: a.mandatory,
              disabled: a.disabled,
              value_action: a.value_action,
              field_message_type: a.field_message_type,
              applies_sc_task: true,
              applies_req_item: true,
            };
            if (a.variable !== undefined) body.variable = a.variable;
            if (a.value_action === 'set_value') body.value = a.value;
            if (a.field_message_type !== 'none')
              body.field_message = a.field_message;
            if (a.cleared !== undefined) body.cleared = a.cleared;

            return client.createRecord<{ sys_id: SnReference }>(
              'catalog_ui_policy_action',
              body,
            );
          }),
        );

        // Single background script to link all newly created actions to their variables and policies
        if (createdRecords.length > 0) {
          const linksLiteral = createdRecords
            .map((record, i) => {
              const actionSysId = record.sys_id.value;
              const { catalog_variable, ui_policy } = toCreate[i];
              return `{a:'${actionSysId}',v:'${catalog_variable}',p:'${ui_policy}'}`;
            })
            .join(',');

          const bgScript = `
var links = [${linksLiteral}];
for (var i = 0; i < links.length; i++) {
  var gr = new GlideRecord('catalog_ui_policy_action');
  if (gr.get(links[i].a)) {
    gr.setValue('catalog_variable', links[i].v);
    gr.setValue('ui_policy', links[i].p);
    gr.update();
  } 
}`;
          await client.executeBackgroundScriptTrigger(bgScript);
        }

        const createdSummary = createdRecords.map((record, i) => ({
          sys_id: record.sys_id.value,
          catalog_variable: toCreate[i].catalog_variable,
          ui_policy: toCreate[i].ui_policy,
          visible: toCreate[i].visible,
          mandatory: toCreate[i].mandatory,
          disabled: toCreate[i].disabled,
        }));

        const lines: string[] = [
          `UI Policy actions complete.`,
          ``,
          `Created: ${createdSummary.length}  |  Skipped (already existed): ${skipped.length}`,
        ];

        if (createdSummary.length > 0) {
          lines.push(``, `Created:`);
          for (const a of createdSummary) {
            lines.push(
              `  policy: ${a.ui_policy}  variable: ${a.catalog_variable}` +
                `  visible: ${a.visible}  mandatory: ${a.mandatory}  disabled: ${a.disabled}`,
            );
          }
        }

        if (skipped.length > 0) {
          lines.push(``, `Skipped (already existed):`);
          for (const a of skipped) {
            lines.push(
              `  policy: ${a.ui_policy}  variable: ${a.catalog_variable}  existing sys_id: ${a.sys_id}`,
            );
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    'update_ui_policy',
    {
      title: 'Update UI Policy',
      description: [
        'Updates fields on an existing catalog_ui_policy record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the UI policy to update.',
        '',
        'CATALOG_CONDITIONS FORMAT: IO:<variable_sys_id>=<value>^EQ',
      ].join('\n'),
      inputSchema: UiPolicyUpdate,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      short_description,
      applies_to,
      catalog_item,
      catalog_conditions,
      active,
      on_load,
      reverse_if_false,
      run_scripts,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid UI policy sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (catalog_item !== undefined && !isSysId(catalog_item)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${catalog_item}" is not a valid catalog item sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (short_description !== undefined)
          body.short_description = short_description;
        if (applies_to !== undefined) body.applies_to = applies_to;
        if (catalog_item !== undefined) body.catalog_item = catalog_item;
        if (catalog_conditions !== undefined)
          body.catalog_conditions = catalog_conditions;
        if (active !== undefined) body.active = String(active);
        if (on_load !== undefined) body.on_load = String(on_load);
        if (reverse_if_false !== undefined)
          body.reverse_if_false = String(reverse_if_false);
        if (run_scripts !== undefined) body.run_scripts = String(run_scripts);

        await client.patchRecord<unknown>('catalog_ui_policy', sys_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `UI Policy updated successfully.`,
                ``,
                `sys_id: ${sys_id}`,
                `Updated fields: ${Object.keys(body).join(', ') || 'none'}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    'update_ui_policy_action',
    {
      title: 'Update UI Policy Action',
      description: [
        'Updates fields on an existing catalog_ui_policy_action record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the UI policy action to update.',
        '',
        "NEVER set mandatory='true' and disabled='true' on the same action.",
        "Use 'ignore' for any effect that should not be changed.",
      ].join('\n'),
      inputSchema: UiPolicyActionUpdate,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      ui_policy,
      catalog_item,
      catalog_variable,
      variable,
      visible,
      mandatory,
      disabled,
      value_action,
      value,
      field_message_type,
      field_message,
      cleared,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid UI policy action sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (mandatory === 'true' && disabled === 'true') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `mandatory and disabled cannot both be 'true' on the same action.`,
              },
            ],
            isError: true,
          };
        }
        if (value_action === 'set_value' && !value) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `value is required when value_action='set_value'.`,
              },
            ],
            isError: true,
          };
        }
        if (
          field_message_type !== undefined &&
          field_message_type !== 'none' &&
          !field_message
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `field_message is required when field_message_type is not 'none'.`,
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (catalog_item !== undefined) body.catalog_item = catalog_item;
        if (catalog_variable !== undefined)
          body.catalog_variable = catalog_variable;
        if (variable !== undefined) body.variable = variable;
        if (visible !== undefined) body.visible = visible;
        if (mandatory !== undefined) body.mandatory = mandatory;
        if (disabled !== undefined) body.disabled = disabled;
        if (value_action !== undefined) body.value_action = value_action;
        if (value_action === 'set_value') body.value = value;
        if (field_message_type !== undefined)
          body.field_message_type = field_message_type;
        if (field_message_type !== undefined && field_message_type !== 'none')
          body.field_message = field_message;
        if (cleared !== undefined) body.cleared = cleared;

        await client.patchRecord<unknown>(
          'catalog_ui_policy_action',
          sys_id,
          body,
        );

        if (catalog_variable !== undefined || ui_policy !== undefined) {
          const catVar = catalog_variable ?? '';
          const uiPol = ui_policy ?? '';
          const bgScript = `var gr = new GlideRecord('catalog_ui_policy_action');
if (gr.get('${sys_id}')) {
  ${catalog_variable !== undefined ? `gr.setValue('catalog_variable', '${catVar}');` : ''}
  ${ui_policy !== undefined ? `gr.setValue('ui_policy', '${uiPol}');` : ''}
  gr.update();
}`;
          await client.executeBackgroundScriptTrigger(bgScript);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `UI Policy action updated successfully.`,
                ``,
                `sys_id: ${sys_id}`,
                `Updated fields: ${Object.keys(body).join(', ') || 'none'}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
