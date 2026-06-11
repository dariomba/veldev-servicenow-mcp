import type { ServiceNowClient } from '../clients/servicenow.js';
import type { SnReference } from '../types/servicenow.js';
import { handleError, isSysId, resolveValue } from './helpers.js';
import type { ToolRegistry } from './registry.js';
import { ScriptIncludeCreate, ScriptIncludeUpdate } from './schemas.js';

export function registerScriptIncludeTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_script_include',
    {
      access: 'write',
      title: 'Create Script Include',
      description: [
        'Creates a sys_script_include record in ServiceNow.',
        '',
        'WHEN TO USE — two cases:',
        '  (1) Reference qualifier (server-side): a catalog variable needs javascript: new <SI>().<method>() in reference_qual.',
        "      Set client_callable=false, access='package_private'.",
        '      The method must return an encoded query string or sys_id list.',
        '      MUST be created BEFORE batch_create_catalog_variables.',
        '  (2) GlideAjax (client-callable): a catalog client script calls server-side code via GlideAjax.',
        "      Set client_callable=true, access='public'.",
        '      The script body must define a class that extends AbstractAjaxProcessor.',
        '      MUST be created BEFORE batch_create_catalog_client_scripts.',
        '',
        'IMPORTANT: name must be a valid JavaScript class name (PascalCase, no spaces).',
        '',
        'Idempotent: if a Script Include with the same name already exists, returns its',
        'sys_id without creating a duplicate.',
      ].join('\n'),
      inputSchema: ScriptIncludeCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ name, script, client_callable, access, description, active }) => {
      try {
        const existing = await client.listRecords<{ sys_id: SnReference }>(
          'sys_script_include',
          `name=${name}`,
          ['sys_id'],
          1,
        );

        if (existing.length > 0) {
          const sys_id = resolveValue(existing[0].sys_id);
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Script Include "${name}" already exists — skipped.`,
                  `sys_id: ${sys_id}`,
                ].join('\n'),
              },
            ],
          };
        }

        const body: Record<string, unknown> = {
          name,
          api_name: name,
          script,
          client_callable: String(client_callable),
          access,
          active: String(active),
        };
        if (description !== undefined) body.description = description;

        const record = await client.createRecord<{ sys_id: SnReference }>(
          'sys_script_include',
          body,
        );

        const sys_id = resolveValue(record.sys_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Script Include created.`,
                ``,
                `Name:            ${name}`,
                `sys_id:          ${sys_id}`,
                `client_callable: ${client_callable}`,
                `access:          ${access}`,
                `active:          ${active}`,
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
    'update_script_include',
    {
      access: 'write',
      title: 'Update Script Include',
      description: [
        'Updates fields on an existing sys_script_include record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the Script Include to update.',
      ].join('\n'),
      inputSchema: ScriptIncludeUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      script,
      client_callable,
      access,
      description,
      active,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid Script Include sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (name !== undefined) {
          body.name = name;
          body.api_name = name;
        }
        if (script !== undefined) body.script = script;
        if (client_callable !== undefined)
          body.client_callable = String(client_callable);
        if (access !== undefined) body.access = access;
        if (description !== undefined) body.description = description;
        if (active !== undefined) body.active = String(active);

        await client.patchRecord<unknown>('sys_script_include', sys_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Script Include updated successfully.`,
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
