import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import { handleError, isSysId, resolveValue } from '../helpers.js';
import type { ToolRegistry } from '../registry.js';
import { RecordProducerCreate, RecordProducerUpdate } from './schemas.js';

export function registerRecordProducerTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_record_producer',
    {
      access: 'write',
      title: 'Create Record Producer',
      description: [
        'Creates a new ServiceNow Record Producer (sc_cat_item_producer record).',
        '',
        'A Record Producer is a catalog form that generates a record in a specified',
        'table (e.g. incident, change_request) when submitted. Variables on the form',
        'are mapped to fields on the generated record.',
        '',
        'Returns the sys_id of the newly created record producer. Save it — every',
        'follow-up step (adding variables, UI policies, client scripts) requires it.',
        '',
        'Call resolve_table to confirm the target table name.',
        'Call list_catalog_categories to resolve a category name to its sys_id.',
      ].join('\n'),
      inputSchema: RecordProducerCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      table_name,
      short_description,
      description,
      catalog_sys_id,
      category_sys_id,
      active,
      order,
      redirect_url,
      script,
      post_insert_script,
      no_save_as_draft,
      flow_designer_flow,
      workflow,
      mandatory_attachment,
      hide_sp,
      no_search,
      availability,
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
          table_name,
          active: String(active),
          order: String(order),
          redirect_url,
        };
        if (script !== undefined) body.script = script;
        if (post_insert_script !== undefined)
          body.post_insert_script = post_insert_script;
        if (short_description !== undefined)
          body.short_description = short_description;
        if (description !== undefined) body.description = description;
        if (catalog_sys_id !== undefined) body.sc_catalogs = catalog_sys_id;
        if (category_sys_id !== undefined) body.category = category_sys_id;
        if (no_save_as_draft !== undefined)
          body.no_save_as_draft = String(no_save_as_draft);
        if (flow_designer_flow !== undefined)
          body.flow_designer_flow = flow_designer_flow;
        if (workflow !== undefined) body.workflow = workflow;
        if (mandatory_attachment !== undefined)
          body.mandatory_attachment = String(mandatory_attachment);
        if (hide_sp !== undefined) body.hide_sp = String(hide_sp);
        if (no_search !== undefined) body.no_search = String(no_search);
        if (availability !== undefined) body.availability = availability;

        const created = await client.createRecord<{
          sys_id: SnReference;
          name: SnReference;
        }>('sc_cat_item_producer', body);

        const sysId = resolveValue(created.sys_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Record producer created successfully.`,
                ``,
                `Name:   ${name}`,
                `Table:  ${table_name}`,
                `sys_id: ${sysId}`,
                ``,
                `Save the sys_id above — you will need it to add variables, UI policies,`,
                `client scripts, or user criteria to this record producer.`,
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
    'update_record_producer',
    {
      access: 'write',
      title: 'Update Record Producer',
      description: [
        'Updates fields on an existing Record Producer (sc_cat_item_producer record).',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the record producer to update.',
        '',
        'Call resolve_table to confirm a target table name.',
        'Call list_catalog_categories to resolve a category name to a sys_id.',
      ].join('\n'),
      inputSchema: RecordProducerUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      table_name,
      short_description,
      description,
      catalog_sys_id,
      category_sys_id,
      active,
      order,
      redirect_url,
      script,
      post_insert_script,
      no_save_as_draft,
      flow_designer_flow,
      workflow,
      mandatory_attachment,
      hide_sp,
      no_search,
      availability,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid record producer sys_id.`,
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
        if (table_name !== undefined) body.table_name = table_name;
        if (short_description !== undefined)
          body.short_description = short_description;
        if (description !== undefined) body.description = description;
        if (catalog_sys_id !== undefined) body.sc_catalogs = catalog_sys_id;
        if (category_sys_id !== undefined) body.category = category_sys_id;
        if (active !== undefined) body.active = String(active);
        if (order !== undefined) body.order = String(order);
        if (redirect_url !== undefined) body.redirect_url = redirect_url;
        if (script !== undefined) body.script = script;
        if (post_insert_script !== undefined)
          body.post_insert_script = post_insert_script;
        if (no_save_as_draft !== undefined)
          body.no_save_as_draft = String(no_save_as_draft);
        if (flow_designer_flow !== undefined)
          body.flow_designer_flow = flow_designer_flow;
        if (workflow !== undefined) body.workflow = workflow;
        if (mandatory_attachment !== undefined)
          body.mandatory_attachment = String(mandatory_attachment);
        if (hide_sp !== undefined) body.hide_sp = String(hide_sp);
        if (no_search !== undefined) body.no_search = String(no_search);
        if (availability !== undefined) body.availability = availability;

        await client.patchRecord<unknown>('sc_cat_item_producer', sys_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Record producer updated successfully.`,
                ``,
                `sys_id:         ${sys_id}`,
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
