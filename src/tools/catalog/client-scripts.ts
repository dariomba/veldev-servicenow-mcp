import { z } from 'zod';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import { handleError, isSysId, resolveValue } from '../helpers.js';
import type { ToolRegistry } from '../registry.js';
import {
  CatalogClientScriptCreate,
  CatalogClientScriptUpdate,
} from './schemas.js';

const UI_TYPE_MAP: Record<string, string> = {
  all: '10',
  desktop: '0',
  mobile: '1',
};

export function registerCatalogClientScriptTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'batch_create_catalog_client_scripts',
    {
      access: 'write',
      title: 'Batch Create Catalog Client Scripts',
      description: [
        'Creates multiple catalog_script_client records in a single call.',
        '',
        'WHEN TO USE: after variables exist and the user wants dynamic browser-side',
        'behavior on the catalog form (show/hide, mandatory, validation, pre-population).',
        'Call this AFTER batch_create_catalog_variables — onChange scripts require the',
        'internal variable names set during variable creation.',
        '',
        "IMPORTANT: type='onChange' requires cat_variable (IO:sys_id).",
        'IMPORTANT: client scripts run BEFORE UI policies — avoid targeting the same field',
        'with both unless you intend the UI policy to override.',
        '',
        'Idempotent: skips any script whose name already exists on the catalog item.',
      ].join('\n'),
      inputSchema: {
        catalog_item_sys_id: z
          .string()
          .min(1)
          .describe(
            'sys_id of the catalog item all scripts in this batch belong to.',
          ),
        scripts: z
          .array(CatalogClientScriptCreate)
          .min(1)
          .describe(
            'Array of client script definitions. All scripts belong to the same catalog item.',
          ),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_item_sys_id, scripts }) => {
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

        for (const s of scripts) {
          if (s.type === 'onChange' && !s.cat_variable) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `cat_variable is required for onChange script "${s.name}".`,
                },
              ],
              isError: true,
            };
          }
        }

        // Parallel idempotency checks
        const existingChecks = await Promise.all(
          scripts.map((s) =>
            client.listRecords<{ sys_id: SnReference }>(
              'catalog_script_client',
              `cat_item=${catalog_item_sys_id}^name=${s.name}`,
              ['sys_id'],
              1,
            ),
          ),
        );

        const toCreate: typeof scripts = [];
        const skipped: Array<{ name: string; sys_id: string }> = [];

        scripts.forEach((s, i) => {
          if (existingChecks[i].length > 0) {
            skipped.push({
              name: s.name,
              sys_id: resolveValue(existingChecks[i][0].sys_id),
            });
          } else {
            toCreate.push(s);
          }
        });

        // Parallel creates for all new scripts
        const createdRecords = await Promise.all(
          toCreate.map((s) => {
            const body: Record<string, unknown> = {
              name: s.name,
              cat_item: catalog_item_sys_id,
              type: s.type,
              script: s.script,
              active: String(s.active),
              ui_type: UI_TYPE_MAP[s.ui_type ?? 'all'],
              order: String(s.order),
            };
            if (s.cat_variable !== undefined)
              body.cat_variable = s.cat_variable;

            return client.createRecord<{ sys_id: SnReference }>(
              'catalog_script_client',
              body,
            );
          }),
        );

        // Background script to fix cat_variable linkage for onChange scripts.
        // The Table API does not persist this reference field correctly.
        const onChangeLinks = createdRecords
          .map((record, i) => ({
            sys_id: resolveValue(record.sys_id),
            s: toCreate[i],
          }))
          .filter(({ s }) => s.cat_variable !== undefined);

        if (onChangeLinks.length > 0) {
          const linksLiteral = onChangeLinks
            .map(({ sys_id, s }) => `{s:'${sys_id}',v:'${s.cat_variable}'}`)
            .join(',');

          const bgScript = `var links = [${linksLiteral}];
for (var i = 0; i < links.length; i++) {
  var gr = new GlideRecord('catalog_script_client');
  if (gr.get(links[i].s)) {
    gr.setValue('cat_variable', links[i].v);
    gr.update();
  }
}`;
          await client.executeBackgroundScriptTrigger(bgScript);
        }

        const createdSummary = createdRecords.map((record, i) => ({
          name: toCreate[i].name,
          type: toCreate[i].type,
          sys_id: resolveValue(record.sys_id),
          cat_variable: toCreate[i].cat_variable,
        }));

        const lines: string[] = [
          `Catalog client scripts complete.`,
          ``,
          `Catalog item: ${catalog_item_sys_id}`,
          `Created: ${createdSummary.length}  |  Skipped (already existed): ${skipped.length}`,
        ];

        if (createdSummary.length > 0) {
          lines.push(``, `Created:`);
          for (const s of createdSummary) {
            const varNote = s.cat_variable
              ? `  [onChange: ${s.cat_variable}]`
              : '';
            lines.push(
              `  ${s.name.padEnd(36)} ${s.type.padEnd(12)} sys_id: ${s.sys_id}${varNote}`,
            );
          }
        }

        if (skipped.length > 0) {
          lines.push(``, `Skipped (already existed):`);
          for (const s of skipped) {
            lines.push(`  ${s.name.padEnd(36)} sys_id: ${s.sys_id}`);
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

  registry.registerTool(
    'update_catalog_client_script',
    {
      access: 'write',
      title: 'Update Catalog Client Script',
      description: [
        'Updates fields on an existing catalog_script_client record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the client script to update.',
      ].join('\n'),
      inputSchema: CatalogClientScriptUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      type,
      script,
      cat_variable,
      active,
      ui_type,
      order,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid catalog client script sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (type !== undefined) body.type = type;
        if (script !== undefined) body.script = script;
        if (active !== undefined) body.active = String(active);
        if (ui_type !== undefined) body.ui_type = UI_TYPE_MAP[ui_type];
        if (order !== undefined) body.order = String(order);
        if (cat_variable !== undefined) body.cat_variable = cat_variable;

        await client.patchRecord<unknown>(
          'catalog_script_client',
          sys_id,
          body,
        );

        if (cat_variable !== undefined) {
          const bgScript = `var gr = new GlideRecord('catalog_script_client');
if (gr.get('${sys_id}')) {
  gr.setValue('cat_variable', '${cat_variable}');
  gr.update();
}`;
          await client.executeBackgroundScriptTrigger(bgScript);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Catalog client script updated successfully.`,
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
