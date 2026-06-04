import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { type SnReference, VARIABLE_TYPE_MAP } from '../types/servicenow.js';
import { handleError, isSysId, resolveValue } from './helpers.js';
import {
  CatalogItemCreate,
  CatalogItemUpdate,
  CatalogVariableCreate,
  CatalogVariableUpdate,
  VARIABLE_TYPES_HINT,
} from './schemas.js';

export function registerCatalogWriteTools(
  server: McpServer,
  client: ServiceNowClient,
): void {
  server.registerTool(
    'create_catalog_item',
    {
      title: 'Create Catalog Item',
      description: [
        'Creates a new ServiceNow catalog item (sc_cat_item record).',
        '',
        'Returns the sys_id of the newly created item. Save it — every follow-up',
        'step (adding variables, UI policies, client scripts) requires it.',
        '',
        'Call list_catalog_categories to resolve a category name to its sys_id.',
      ].join('\n'),
      inputSchema: CatalogItemCreate,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      short_description,
      description,
      catalog_sys_id,
      category_sys_id,
      active,
      order,
      price,
      flow_designer_flow,
      workflow,
      request_method,
    }) => {
      try {
        if (catalog_sys_id && !isSysId(catalog_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${catalog_sys_id}" is not a valid sys_id (must be 32 hex chars).`,
              },
            ],
            isError: true,
          };
        }
        if (category_sys_id && !isSysId(category_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `"${category_sys_id}" is not a valid category sys_id. ` +
                  `Call list_catalog_categories to find the sys_id for that category name.`,
              },
            ],
            isError: true,
          };
        }
        if (flow_designer_flow !== undefined && workflow !== undefined) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Provide either flow_designer_flow or workflow, not both.',
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {
          name,
          active: String(active),
          order: String(order),
        };
        if (short_description !== undefined)
          body.short_description = short_description;
        if (description !== undefined) body.description = description;
        if (catalog_sys_id !== undefined) body.sc_catalogs = catalog_sys_id;
        if (category_sys_id !== undefined) body.category = category_sys_id;
        if (price !== undefined) body.price = price;
        if (flow_designer_flow !== undefined)
          body.flow_designer_flow = flow_designer_flow;
        if (workflow !== undefined) body.workflow = workflow;
        if (request_method !== undefined) body.request_method = request_method;

        const created = await client.createRecord<{
          sys_id: SnReference;
          name: SnReference;
        }>('sc_cat_item', body);

        const sysId = resolveValue(created.sys_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Catalog item created successfully.`,
                ``,
                `Name:   ${name}`,
                `sys_id: ${sysId}`,
                ``,
                `Save the sys_id above — you will need it to add variables, UI policies,`,
                `client scripts, or user criteria to this item.`,
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
    'associate_variable_set',
    {
      title: 'Associate Variable Set to Catalog Item',
      description: [
        'Links an existing variable set (io_set) to a catalog item by creating an',
        'io_set_item junction record.',
        '',
        'Idempotent: if the association already exists the tool reports it and stops',
        '— no duplicate record is created.',
        '',
        'Call this once per variable set, in the order you want them to appear.',
      ].join('\n'),
      inputSchema: {
        catalog_item_sys_id: z
          .string()
          .min(1)
          .describe('sys_id of the target catalog item (sc_cat_item).'),
        variable_set_sys_id: z
          .string()
          .min(1)
          .describe('sys_id of the variable set (io_set) to associate.'),
        order: z
          .number()
          .int()
          .optional()
          .default(100)
          .describe(
            'Display order of this variable set on the item form. Defaults to 100.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_item_sys_id, variable_set_sys_id, order }) => {
      try {
        if (!isSysId(catalog_item_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${catalog_item_sys_id}" is not a valid catalog item sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (!isSysId(variable_set_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${variable_set_sys_id}" is not a valid variable set sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          'io_set_item',
          `sc_cat_item=${catalog_item_sys_id}^variable_set=${variable_set_sys_id}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Variable set is already associated with this catalog item — no change made.`,
                  ``,
                  `io_set_item sys_id: ${resolveValue(existing[0].sys_id)}`,
                ].join('\n'),
              },
            ],
          };
        }

        const created = await client.createRecord<{ sys_id: SnReference }>(
          'io_set_item',
          {
            sc_cat_item: catalog_item_sys_id,
            variable_set: variable_set_sys_id,
            order: String(order),
          },
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Variable set associated successfully.`,
                ``,
                `io_set_item sys_id: ${resolveValue(created.sys_id)}`,
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
    'batch_create_catalog_variables',
    {
      title: 'Batch Create Catalog Variables',
      description: [
        'Creates multiple variables (item_option_new records) on a catalog item in a single call.',
        'All variables must belong to the same catalog item.',
        '',
        'Idempotent per variable: skips creation if a variable with the same name already',
        'exists on the item. Returns sys_ids for all created and skipped variables.',
      ].join('\n'),

      inputSchema: {
        catalog_item_sys_id: z
          .string()
          .min(1)
          .describe('sys_id of the catalog item to attach all variables to.'),
        variables: z
          .array(CatalogVariableCreate)
          .min(1)
          .describe(
            'Array of variable definitions to create. All belong to the same catalog item.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_item_sys_id, variables }) => {
      try {
        if (!isSysId(catalog_item_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${catalog_item_sys_id}" is not a valid catalog item sys_id.`,
              },
            ],
            isError: true,
          };
        }

        // Parallel idempotency checks for all variables
        const existingChecks = await Promise.all(
          variables.map((v) =>
            client.listRecords<{ sys_id: SnReference; name: SnReference }>(
              'item_option_new',
              `cat_item=${catalog_item_sys_id}^name=${v.name}`,
              ['sys_id', 'name'],
              1,
            ),
          ),
        );

        const toCreate: typeof variables = [];
        const skipped: Array<{ name: string; sys_id: string }> = [];

        variables.forEach((v, i) => {
          if (existingChecks[i].length > 0) {
            skipped.push({
              name: v.name,
              sys_id: resolveValue(existingChecks[i][0].sys_id),
            });
          } else {
            toCreate.push(v);
          }
        });

        // Parallel creates for all new variables
        const createdRecords = await Promise.all(
          toCreate.map((v) => {
            const body: Record<string, unknown> = {
              cat_item: catalog_item_sys_id,
              name: v.name,
              question_text: v.question_text,
              type: v.type,
              mandatory: String(v.mandatory),
              hidden: String(v.hidden),
              active: String(v.active),
              order: String(v.order),
            };
            if (v.reference_table !== undefined)
              body.reference = v.reference_table;
            if (v.lookup_source !== undefined)
              body.lookup_source = v.lookup_source;
            if (v.lookup_table !== undefined)
              body.lookup_table = v.lookup_table;
            if (v.lookup_value !== undefined)
              body.lookup_value = v.lookup_value;
            if (v.lookup_label !== undefined)
              body.lookup_label = v.lookup_label;
            if (v.lookup_unique !== undefined)
              body.lookup_unique = String(v.lookup_unique);
            if (v.choice_table !== undefined)
              body.choice_table = v.choice_table;
            if (v.choice_field !== undefined)
              body.choice_field = v.choice_field;
            if (v.lookup_dependent_question !== undefined)
              body.lookup_dependent_question = v.lookup_dependent_question;
            if (v.choice_direction !== undefined)
              body.choice_direction = v.choice_direction;
            if (v.list_table !== undefined) body.list_table = v.list_table;
            if (v.use_reference_qualifier !== undefined)
              body.use_reference_qualifier = v.use_reference_qualifier;
            if (v.reference_qual_condition !== undefined)
              body.reference_qual_condition = v.reference_qual_condition;
            if (v.reference_qual !== undefined)
              body.reference_qual = v.reference_qual;
            if (v.attributes !== undefined) body.attributes = v.attributes;
            if (v.default_value !== undefined)
              body.default_value = v.default_value;
            if (v.dynamic_value_field !== undefined)
              body.dynamic_value_field = v.dynamic_value_field;
            if (v.dynamic_value_dot_walk_path !== undefined)
              body.dynamic_value_dot_walk_path = v.dynamic_value_dot_walk_path;
            if (v.validate_regex !== undefined)
              body.validate_regex = v.validate_regex;
            if (v.validation_message !== undefined)
              body.validation_message = v.validation_message;
            if (v.help_text !== undefined) body.help_text = v.help_text;
            if (v.show_help !== undefined) body.show_help = String(v.show_help);
            if (v.show_help_on_load !== undefined)
              body.show_help_on_load = String(v.show_help_on_load);
            if (v.tooltip !== undefined) body.tooltip = v.tooltip;
            if (v.do_not_select_first !== undefined)
              body.do_not_select_first = String(v.do_not_select_first);
            if (v.include_none !== undefined)
              body.include_none = String(v.include_none);
            if (v.read_only !== undefined) body.read_only = String(v.read_only);
            if (v.global !== undefined) body.global = String(v.global);
            if (v.display_title !== undefined)
              body.display_title = String(v.display_title);
            if (v.layout !== undefined) body.layout = v.layout;
            if (v.map_to_field !== undefined)
              body.map_to_field = String(v.map_to_field);
            if (v.field !== undefined) body.field = v.field;

            return client.createRecord<{ sys_id: SnReference }>(
              'item_option_new',
              body,
            );
          }),
        );

        // Parallel choice creation for all variables that have choices
        const choiceTasks: Promise<unknown>[] = [];
        createdRecords.forEach((record, i) => {
          const v = toCreate[i];
          if (v.choices && v.choices.length > 0) {
            const varSysId = resolveValue(record.sys_id);
            v.choices.forEach((choice, idx) => {
              choiceTasks.push(
                client.createRecord('question_choice', {
                  question: varSysId,
                  text: choice.text,
                  value: choice.value,
                  order: String(choice.order ?? (idx + 1) * 100),
                }),
              );
            });
          }
        });
        await Promise.all(choiceTasks);

        const createdSummary = createdRecords.map((record, i) => ({
          name: toCreate[i].name,
          type: toCreate[i].type,
          sys_id: resolveValue(record.sys_id),
          choiceCount: toCreate[i].choices?.length ?? 0,
        }));

        const lines: string[] = [
          `Batch variable creation complete.`,
          ``,
          `Catalog item: ${catalog_item_sys_id}`,
          `Created: ${createdSummary.length}  |  Skipped (already existed): ${skipped.length}`,
        ];

        if (createdSummary.length > 0) {
          lines.push(``, `Created:`);
          for (const v of createdSummary) {
            const typeLabel = VARIABLE_TYPE_MAP[v.type] ?? v.type;
            const choiceNote =
              v.choiceCount > 0 ? `  [${v.choiceCount} choices]` : '';
            lines.push(
              `  ${v.name.padEnd(32)} sys_id: ${v.sys_id}  [${typeLabel}]${choiceNote}`,
            );
          }
        }

        if (skipped.length > 0) {
          lines.push(``, `Skipped (already existed):`);
          for (const v of skipped) {
            lines.push(`  ${v.name.padEnd(32)} sys_id: ${v.sys_id}`);
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
    'update_catalog_item',
    {
      title: 'Update Catalog Item',
      description: [
        'Updates fields on an existing catalog item (sc_cat_item record).',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the catalog item to update.',
        '',
        'Call list_catalog_categories to resolve a category name to a sys_id.',
      ].join('\n'),
      inputSchema: CatalogItemUpdate,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      short_description,
      description,
      catalog_sys_id,
      category_sys_id,
      active,
      order,
      price,
      flow_designer_flow,
      workflow,
      request_method,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid catalog item sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (catalog_sys_id !== undefined && !isSysId(catalog_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${catalog_sys_id}" is not a valid catalog sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (category_sys_id !== undefined && !isSysId(category_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${category_sys_id}" is not a valid category sys_id. Call list_catalog_categories to find the sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (flow_designer_flow !== undefined && workflow !== undefined) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Provide either flow_designer_flow or workflow, not both.',
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (short_description !== undefined)
          body.short_description = short_description;
        if (description !== undefined) body.description = description;
        if (catalog_sys_id !== undefined) body.sc_catalogs = catalog_sys_id;
        if (category_sys_id !== undefined) body.category = category_sys_id;
        if (active !== undefined) body.active = String(active);
        if (order !== undefined) body.order = String(order);
        if (price !== undefined) body.price = price;
        if (flow_designer_flow !== undefined)
          body.flow_designer_flow = flow_designer_flow;
        if (workflow !== undefined) body.workflow = workflow;
        if (request_method !== undefined) body.request_method = request_method;

        await client.patchRecord<unknown>('sc_cat_item', sys_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Catalog item updated successfully.`,
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
    'batch_update_catalog_variables',
    {
      title: 'Batch Update Catalog Variables',
      description: [
        'Updates fields on existing catalog item variables (item_option_new records).',
        '',
        'Pass only the fields you want to change per variable — omitted fields are unchanged.',
        'Each entry must include the sys_id of the variable to update.',
        '',
        'CHOICES: each entry with sys_id patches that question_choice; entries without sys_id create a new choice.',
        'Omit the choices array to leave existing choices untouched.',
        '',
        `Variable type codes: ${VARIABLE_TYPES_HINT}`,
      ].join('\n'),
      inputSchema: {
        variables: z
          .array(CatalogVariableUpdate)
          .min(1)
          .describe(
            'Array of variable updates. Each entry must include sys_id of the variable to update.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ variables }) => {
      try {
        for (const v of variables) {
          if (!isSysId(v.sys_id)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `"${v.sys_id}" is not a valid variable sys_id.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Parallel PATCH all variables
        await Promise.all(
          variables.map((v) => {
            const body: Record<string, unknown> = {};
            if (v.name !== undefined) body.name = v.name;
            if (v.question_text !== undefined)
              body.question_text = v.question_text;
            if (v.type !== undefined) body.type = v.type;
            if (v.mandatory !== undefined) body.mandatory = String(v.mandatory);
            if (v.hidden !== undefined) body.hidden = String(v.hidden);
            if (v.active !== undefined) body.active = String(v.active);
            if (v.order !== undefined) body.order = String(v.order);
            if (v.reference_table !== undefined)
              body.reference = v.reference_table;
            if (v.lookup_source !== undefined)
              body.lookup_source = v.lookup_source;
            if (v.lookup_table !== undefined)
              body.lookup_table = v.lookup_table;
            if (v.lookup_value !== undefined)
              body.lookup_value = v.lookup_value;
            if (v.lookup_label !== undefined)
              body.lookup_label = v.lookup_label;
            if (v.lookup_unique !== undefined)
              body.lookup_unique = String(v.lookup_unique);
            if (v.choice_table !== undefined)
              body.choice_table = v.choice_table;
            if (v.choice_field !== undefined)
              body.choice_field = v.choice_field;
            if (v.lookup_dependent_question !== undefined)
              body.lookup_dependent_question = v.lookup_dependent_question;
            if (v.choice_direction !== undefined)
              body.choice_direction = v.choice_direction;
            if (v.list_table !== undefined) body.list_table = v.list_table;
            if (v.use_reference_qualifier !== undefined)
              body.use_reference_qualifier = v.use_reference_qualifier;
            if (v.reference_qual_condition !== undefined)
              body.reference_qual_condition = v.reference_qual_condition;
            if (v.reference_qual !== undefined)
              body.reference_qual = v.reference_qual;
            if (v.attributes !== undefined) body.attributes = v.attributes;
            if (v.default_value !== undefined)
              body.default_value = v.default_value;
            if (v.dynamic_value_field !== undefined)
              body.dynamic_value_field = v.dynamic_value_field;
            if (v.dynamic_value_dot_walk_path !== undefined)
              body.dynamic_value_dot_walk_path = v.dynamic_value_dot_walk_path;
            if (v.validate_regex !== undefined)
              body.validate_regex = v.validate_regex;
            if (v.validation_message !== undefined)
              body.validation_message = v.validation_message;
            if (v.help_text !== undefined) body.help_text = v.help_text;
            if (v.show_help !== undefined) body.show_help = String(v.show_help);
            if (v.show_help_on_load !== undefined)
              body.show_help_on_load = String(v.show_help_on_load);
            if (v.tooltip !== undefined) body.tooltip = v.tooltip;
            if (v.do_not_select_first !== undefined)
              body.do_not_select_first = String(v.do_not_select_first);
            if (v.include_none !== undefined)
              body.include_none = String(v.include_none);
            if (v.read_only !== undefined) body.read_only = String(v.read_only);
            if (v.global !== undefined) body.global = String(v.global);
            if (v.display_title !== undefined)
              body.display_title = String(v.display_title);
            if (v.layout !== undefined) body.layout = v.layout;
            if (v.map_to_field !== undefined)
              body.map_to_field = String(v.map_to_field);
            if (v.field !== undefined) body.field = v.field;
            return client.patchRecord<unknown>(
              'item_option_new',
              v.sys_id,
              body,
            );
          }),
        );

        // Update or create choices for variables that include a choices array
        const choiceVars = variables.filter(
          (v) => v.choices !== undefined && v.choices.length > 0,
        );
        await Promise.all(
          choiceVars.flatMap((v) =>
            (v.choices ?? []).map((choice, idx) => {
              const body: Record<string, unknown> = {
                text: choice.text,
                value: choice.value,
                order: String(choice.order ?? (idx + 1) * 100),
              };
              if (choice.sys_id) {
                return client.patchRecord(
                  'question_choice',
                  choice.sys_id,
                  body,
                );
              }
              return client.createRecord('question_choice', {
                ...body,
                question: v.sys_id,
              });
            }),
          ),
        );

        const lines: string[] = [
          `Batch variable update complete.`,
          ``,
          `Updated: ${variables.length}`,
        ];
        for (const v of variables) {
          const typeLabel =
            v.type !== undefined
              ? ` [type: ${VARIABLE_TYPE_MAP[v.type] ?? v.type}]`
              : '';
          const choiceNote =
            v.choices !== undefined
              ? ` [${v.choices.length} choices updated/created]`
              : '';
          lines.push(`  sys_id: ${v.sys_id}${typeLabel}${choiceNote}`);
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
    'attach_user_criteria',
    {
      title: 'Attach User Criteria to Catalog Item',
      description: [
        'Attaches a user criteria record to a catalog item to control who can see and order it.',
        '',
        'WHEN TO USE: Call this ONLY after find_user_criteria has returned results AND the user',
        'has explicitly confirmed which criteria to attach.',
        'NEVER call this without prior user confirmation.',
        '',
        'restriction_type controls which table is written to:',
        "  available_for     → sc_cat_item_user_criteria_mtom     ('visible to', 'restricted to')",
        "  not_available_for → sc_cat_item_user_criteria_no_mtom  ('not for', 'exclude', 'block', 'hide from')",
        '',
        'IMPORTANT: Not Available For always overrides Available For.',
        'Scripted criteria changes require a session relaunch to take effect.',
        'Standard criteria changes take effect immediately.',
      ].join('\n'),
      inputSchema: {
        catalog_item_sys_id: z
          .string()
          .min(1)
          .describe(
            'sys_id of the catalog item to attach the criteria to (sc_cat_item).',
          ),
        user_criteria_sys_id: z
          .string()
          .min(1)
          .describe(
            'sys_id of the user_criteria record to attach. From find_user_criteria results.',
          ),
        restriction_type: z
          .enum(['available_for', 'not_available_for'])
          .describe(
            '"available_for" → sc_cat_item_user_criteria_mtom. "not_available_for" → sc_cat_item_user_criteria_no_mtom.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ catalog_item_sys_id, user_criteria_sys_id, restriction_type }) => {
      try {
        if (!isSysId(catalog_item_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${catalog_item_sys_id}" is not a valid catalog item sys_id.`,
              },
            ],
            isError: true,
          };
        }
        if (!isSysId(user_criteria_sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${user_criteria_sys_id}" is not a valid user criteria sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const table =
          restriction_type === 'available_for'
            ? 'sc_cat_item_user_criteria_mtom'
            : 'sc_cat_item_user_criteria_no_mtom';

        const created = await client.createRecord<{ sys_id: SnReference }>(
          table,
          {
            sc_cat_item: catalog_item_sys_id,
            user_criteria: user_criteria_sys_id,
          },
        );

        const label =
          restriction_type === 'available_for'
            ? 'Available For'
            : 'Not Available For';

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `User criteria attached successfully.`,
                ``,
                `Catalog item:   ${catalog_item_sys_id}`,
                `User criteria:  ${user_criteria_sys_id}`,
                `Restriction:    ${label}`,
                `Junction sys_id: ${resolveValue(created.sys_id)}`,
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
