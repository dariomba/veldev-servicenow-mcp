import { z } from 'zod';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import { handleError } from '../helpers.js';
import type { ToolRegistry } from '../registry.js';

export function registerTableCrudTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'query_records',
    {
      access: 'read',
      title: 'Query Records',
      description: [
        'Query any ServiceNow table using an encoded query string.',
        '',
        'WHEN TO USE: When you need to search or filter records in any table.',
        'Use get_record to fetch a single known record by sys_id.',
        '',
        'Encoded query format: field=value^field2STARTSWITH prefix',
        'Operators: =, !=, STARTSWITH, ENDSWITH, CONTAINS, IN, ISEMPTY, ISNOTEMPTY, >, <, >=, <=',
        'Join conditions with ^ (AND) or ^OR (OR).',
        'Example: "state=1^priority=2" returns records matching both conditions.',
        '',
        'Returns raw JSON. Reference fields have the shape { value, display_value };',
        'use .value for the sys_id and .display_value for the human label.',
      ].join('\n'),
      inputSchema: {
        table: z
          .string()
          .min(1)
          .describe('ServiceNow table name (e.g. "incident", "sys_user").'),
        query: z
          .string()
          .optional()
          .describe(
            'Encoded query string (e.g. "state=1^priority=2"). Leave empty to retrieve records without filtering.',
          ),
        fields: z
          .array(z.string().min(1))
          .optional()
          .describe('Fields to return. Leave empty to return all fields.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe(
            'Maximum number of records to return (1–100). Defaults to 20.',
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Zero-based index of the first record to return. Use with limit for pagination.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ table, query, fields, limit, offset }) => {
      try {
        const records = await client.listRecords<Record<string, unknown>>(
          table,
          query ?? '',
          fields,
          limit ?? 20,
          offset,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(records, null, 2),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_record',
    {
      access: 'read',
      title: 'Get Record',
      description: [
        'Fetch a single ServiceNow record by sys_id from any table.',
        '',
        'WHEN TO USE: When you know the exact sys_id of the record.',
        'Use query_records when you need to search or filter.',
        '',
        'Returns raw JSON. Reference fields have the shape { value, display_value };',
        'use .value for the sys_id and .display_value for the human label.',
      ].join('\n'),
      inputSchema: {
        table: z
          .string()
          .min(1)
          .describe('ServiceNow table name (e.g. "incident", "sys_user").'),
        sys_id: z
          .string()
          .length(32)
          .describe('32-character sys_id of the record to fetch.'),
        fields: z
          .array(z.string().min(1))
          .optional()
          .describe('Fields to return. Leave empty to return all fields.'),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ table, sys_id, fields }) => {
      try {
        const record = await client.getRecord<Record<string, unknown>>(
          table,
          sys_id,
          fields,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(record, null, 2),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'create_record',
    {
      access: 'write',
      title: 'Create Record',
      description: [
        'Create a new record in any ServiceNow table.',
        '',
        'WHEN TO USE: When you need to insert a new record into any table.',
        'Field values are passed as plain strings; ServiceNow coerces types automatically.',
        '',
        'Returns the sys_id and, when present, the record number (e.g. INC0010001).',
      ].join('\n'),
      inputSchema: {
        table: z
          .string()
          .min(1)
          .describe(
            'ServiceNow table name (e.g. "incident", "change_request").',
          ),
        data: z
          .record(z.string(), z.unknown())
          .describe(
            'Fields and values for the new record. Field names must match the table schema.',
          ),
      },
    },
    async ({ table, data }) => {
      try {
        const created = await client.createRecord<{
          sys_id: SnReference;
          number?: SnReference;
        }>(table, data);

        const lines = [
          `Created record in "${table}".`,
          `sys_id: ${created.sys_id.value}`,
        ];
        if (created.number?.value)
          lines.push(`number: ${created.number.value}`);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_record',
    {
      access: 'write',
      title: 'Update Record',
      description: [
        'Update an existing ServiceNow record by sys_id.',
        '',
        'WHEN TO USE: When you need to modify fields on an existing record.',
        '',
        'patch=true  — PATCH: partial update, only the supplied fields are changed.',
        'patch=false — PUT: full replacement. WARNING: fields NOT included in data',
        '              may be reset to their default or empty values. Use with caution.',
        '',
        'Prefer patch=true unless a full replacement is intentional.',
      ].join('\n'),
      inputSchema: {
        table: z
          .string()
          .min(1)
          .describe('ServiceNow table name (e.g. "incident", "sys_user").'),
        sys_id: z
          .string()
          .length(32)
          .describe('32-character sys_id of the record to update.'),
        data: z
          .record(z.string(), z.unknown())
          .describe('Fields and values to update.'),
        patch: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'true = PATCH (partial update, only supplied fields change). Defaults to true. ' +
              'false = PUT (full replace — omitted fields may be cleared). Use with caution.',
          ),
      },
    },
    async ({ table, sys_id, data, patch }) => {
      try {
        if (patch) {
          await client.patchRecord(table, sys_id, data);
        } else {
          await client.updateRecord(table, sys_id, data);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated record in "${table}" (sys_id: ${sys_id}) using ${patch ? 'PATCH' : 'PUT'}.`,
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
