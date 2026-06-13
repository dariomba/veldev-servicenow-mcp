import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import { handleError, isSysId } from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import { BusinessRuleCreate, BusinessRuleUpdate } from './schemas.js';

export function registerBusinessRuleTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_business_rule',
    {
      access: 'write',
      title: 'Create Business Rule',
      description: [
        'Creates a sys_script record (business rule) on a ServiceNow table.',
        '',
        'WHEN TO USE: when server-side logic must run regardless of how the record',
        'is modified — form, list editor, REST API, or import set.',
        'For client-side / form-only behavior use catalog client scripts or UI policies.',
        '',
        "Set advanced=true whenever you need a script, a specific 'when' value,",
        'execution order, or delete/query triggers.',
        'Set advanced=false only for simple field-setter or abort rules with no script.',
        '',
        'IMPORTANT: use async_always for outbound REST or email — never block a save.',
        '',
        'Idempotent: if a rule with the same name already exists on the same table,',
        'the existing record is returned and no new record is created.',
      ].join('\n'),
      inputSchema: BusinessRuleCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      name,
      collection,
      active,
      advanced,
      action_insert,
      action_update,
      action_delete,
      action_query,
      filter_condition,
      role_conditions,
      template,
      add_message,
      abort_action,
      when,
      order,
      condition,
      script,
    }) => {
      try {
        const existing = await client.listRecords<{ sys_id: SnReference }>(
          'sys_script',
          `name=${name}^collection=${collection}`,
          ['sys_id'],
          1,
        );

        if (existing.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Business rule already exists — skipped.`,
                  ``,
                  `name:       ${name}`,
                  `collection: ${collection}`,
                  `sys_id:     ${existing[0].sys_id.value}`,
                ].join('\n'),
              },
            ],
          };
        }

        const isAdvanced = advanced === true;

        const body: Record<string, unknown> = {
          name,
          collection,
          active: String(active ?? true),
          advanced: String(isAdvanced),
          action_insert: String(action_insert ?? false),
          action_update: String(action_update ?? false),
          action_delete: String(isAdvanced ? (action_delete ?? false) : false),
          action_query: String(isAdvanced ? (action_query ?? false) : false),
        };

        if (filter_condition !== undefined)
          body.filter_condition = filter_condition;
        if (role_conditions !== undefined)
          body.role_conditions = role_conditions;
        if (template !== undefined) body.template = template;
        if (add_message !== undefined) body.add_message = String(add_message);
        if (abort_action !== undefined)
          body.abort_action = String(abort_action);

        if (isAdvanced) {
          if (when !== undefined) body.when = when;
          if (order !== undefined) body.order = String(order);
          if (condition !== undefined) body.condition = condition;
          if (script !== undefined) body.script = script;
        }

        const record = await client.createRecord<{ sys_id: SnReference }>(
          'sys_script',
          body,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Business rule created successfully.`,
                ``,
                `name:       ${name}`,
                `collection: ${collection}`,
                `advanced: ${isAdvanced}`,
                `when:     ${when ?? '—'}`,
                `sys_id:   ${record.sys_id.value}`,
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
    'update_business_rule',
    {
      access: 'write',
      title: 'Update Business Rule',
      description: [
        'Updates fields on an existing sys_script record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the business rule to update.',
      ].join('\n'),
      inputSchema: BusinessRuleUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      collection,
      active,
      advanced,
      action_insert,
      action_update,
      action_delete,
      action_query,
      filter_condition,
      role_conditions,
      template,
      add_message,
      abort_action,
      when,
      order,
      condition,
      script,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${sys_id}" is not a valid business rule sys_id.`,
              },
            ],
            isError: true,
          };
        }

        const isAdvanced = advanced === true;
        const body: Record<string, unknown> = {};

        if (name !== undefined) body.name = name;
        if (collection !== undefined) body.collection = collection;
        if (active !== undefined) body.active = String(active);
        if (advanced !== undefined) body.advanced = String(advanced);

        if (action_insert !== undefined)
          body.action_insert = String(action_insert);
        if (action_update !== undefined)
          body.action_update = String(action_update);
        if (action_delete !== undefined)
          body.action_delete = String(isAdvanced ? action_delete : false);
        if (action_query !== undefined)
          body.action_query = String(isAdvanced ? action_query : false);

        if (filter_condition !== undefined)
          body.filter_condition = filter_condition;
        if (role_conditions !== undefined)
          body.role_conditions = role_conditions;
        if (template !== undefined) body.template = template;
        if (add_message !== undefined) body.add_message = String(add_message);
        if (abort_action !== undefined)
          body.abort_action = String(abort_action);

        if (when !== undefined) body.when = when;
        if (order !== undefined) body.order = String(order);
        if (condition !== undefined) body.condition = condition;
        if (script !== undefined) body.script = script;

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

        await client.patchRecord<unknown>('sys_script', sys_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Business rule updated successfully.`,
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
