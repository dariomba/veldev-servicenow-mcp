import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import { handleError, isSysId, resolveValue } from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import { ClientScriptCreate, ClientScriptUpdate } from './schemas.js';

const UI_TYPE_MAP: Record<string, string> = {
  desktop: '0',
  mobile: '1',
  all: '10',
};

// onChange and onCellEdit scripts target a specific field.
const FIELD_REQUIRED_TYPES = new Set(['onChange', 'onCellEdit']);

export function registerClientScriptTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_client_script',
    {
      access: 'write',
      title: 'Create Client Script',
      description: [
        'Creates a sys_script_client record (client script) on a ServiceNow table.',
        '',
        'WHEN TO USE: when form behavior must run in the browser — set defaults, toggle',
        'mandatory/read-only/visible state, react to a field change, or validate on submit.',
        'For server-side logic use create_business_rule. For catalog item forms use the',
        'catalog client script tools instead.',
        '',
        "IMPORTANT: type='onChange' and type='onCellEdit' require field (the internal",
        'name of the field to watch).',
        'IMPORTANT: client scripts run BEFORE UI policies — avoid targeting the same field',
        'with both unless you intend the UI policy to win.',
        '',
        'Idempotent: if a client script with the same name already exists on the same table,',
        'the existing record is returned and no new record is created.',
      ].join('\n'),
      inputSchema: ClientScriptCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      name,
      table,
      type,
      field,
      script,
      active,
      ui_type,
      global,
      view,
      applies_extended,
      isolate_script,
      order,
      description,
      messages,
    }) => {
      try {
        if (FIELD_REQUIRED_TYPES.has(type) && !field) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `field is required for ${type} client script "${name}".`,
              },
            ],
            isError: true,
          };
        }

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          'sys_script_client',
          `name=${name}^table=${table}`,
          ['sys_id'],
          1,
        );

        if (existing.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Client script already exists — skipped.`,
                  ``,
                  `name:   ${name}`,
                  `table:  ${table}`,
                  `sys_id: ${resolveValue(existing[0].sys_id)}`,
                ].join('\n'),
              },
            ],
          };
        }

        const body: Record<string, unknown> = {
          name,
          table,
          type,
          script,
          active: String(active),
          ui_type: UI_TYPE_MAP[ui_type],
          global: String(global),
          applies_extended: String(applies_extended),
          isolate_script: String(isolate_script),
        };

        if (field !== undefined) body.field = field;
        if (view !== undefined) body.view = view;
        if (order !== undefined) body.order = String(order);
        if (description !== undefined) body.description = description;
        if (messages !== undefined) body.messages = messages;

        const record = await client.createRecord<{ sys_id: SnReference }>(
          'sys_script_client',
          body,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Client script created successfully.`,
                ``,
                `name:   ${name}`,
                `table:  ${table}`,
                `type:   ${type}`,
                `field:  ${field ?? '—'}`,
                `sys_id: ${resolveValue(record.sys_id)}`,
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
    'update_client_script',
    {
      access: 'write',
      title: 'Update Client Script',
      description: [
        'Updates fields on an existing sys_script_client record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the client script to update.',
      ].join('\n'),
      inputSchema: ClientScriptUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      table,
      type,
      field,
      script,
      active,
      ui_type,
      global,
      view,
      applies_extended,
      isolate_script,
      order,
      description,
      messages,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid client script sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (table !== undefined) body.table = table;
        if (type !== undefined) body.type = type;
        if (field !== undefined) body.field = field;
        if (script !== undefined) body.script = script;
        if (active !== undefined) body.active = String(active);
        if (ui_type !== undefined) body.ui_type = UI_TYPE_MAP[ui_type];
        if (global !== undefined) body.global = String(global);
        if (view !== undefined) body.view = view;
        if (applies_extended !== undefined)
          body.applies_extended = String(applies_extended);
        if (isolate_script !== undefined)
          body.isolate_script = String(isolate_script);
        if (order !== undefined) body.order = String(order);
        if (description !== undefined) body.description = description;
        if (messages !== undefined) body.messages = messages;

        if (Object.keys(body).length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No fields to update — all values were omitted.`,
              },
            ],
          };
        }

        await client.patchRecord<unknown>('sys_script_client', sys_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Client script updated successfully.`,
                ``,
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
}
