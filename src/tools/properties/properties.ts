import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord, SnReference } from '../../types/servicenow.js';
import {
  errText,
  handleError,
  recordUrl,
  resolveValue,
  richResult,
  serializeFields,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  PROPERTY_FIELDS,
  PROPERTY_UPDATE_FIELDS,
  PropertyCreate,
  PropertyGet,
  PropertyList,
  PropertyUpdate,
} from './schemas.js';

const TABLE = 'sys_properties';

/**
 * Warns when a typed property holds a value that does not match its declared
 * `type` — ServiceNow stores `value` as text and never validates it, so a
 * "boolean" holding "yes" or an "integer" holding "30s" silently misbehaves at
 * read time. Returns the warning lines to append (empty when consistent).
 * `value`/`type` may be undefined (e.g. a partial update); both must be present
 * to check.
 */
function typeValueWarnings(
  type: string | undefined,
  value: string | undefined,
): string[] {
  if (type === undefined || value === undefined || value === '') return [];
  if (type === 'integer' && !/^-?\d+$/.test(value.trim())) {
    return [
      `WARNING: type=integer but value "${value}" is not a whole number — ` +
        'gs.getProperty() callers expecting an integer may misbehave.',
    ];
  }
  if (
    type === 'boolean' &&
    !['true', 'false'].includes(value.trim().toLowerCase())
  ) {
    return [
      `WARNING: type=boolean but value "${value}" is not "true"/"false" — ` +
        'gs.getProperty(name) === "true" checks will not match as intended.',
    ];
  }
  return [];
}

export function registerPropertyTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_property',
    {
      access: 'write',
      title: 'Create System Property',
      description: [
        'Creates a sys_properties record — a named configuration value read at',
        'runtime with gs.getProperty(name).',
        '',
        '`value` is always stored as text; `type` only tells callers how to',
        'interpret it (it does not coerce or validate). is_private=true keeps the',
        'property out of update sets; ignore_cache=true skips the cache flush on',
        'change.',
        '',
        'Idempotent: an existing property with the same `name` is returned',
        'unchanged (name is the natural key). Use update_property to change it.',
      ].join('\n'),
      inputSchema: PropertyCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { name, type, value } = input;

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `name=${name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return textResult(
            [
              'System property already exists — skipped.',
              '',
              `name:   ${name}`,
              `sys_id: ${resolveValue(existing[0].sys_id)}`,
              '',
              'Use update_property to change its value.',
            ].join('\n'),
          );
        }

        const body = serializeFields(input, PROPERTY_FIELDS);
        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        const lines = [
          'System property created.',
          '',
          `name:         ${name}`,
          `type:         ${type}`,
          `value:        ${value === undefined ? '(empty)' : value}`,
          `is_private:   ${input.is_private === true}`,
          `ignore_cache: ${input.ignore_cache === true}`,
          `sys_id:       ${sys_id}`,
          `URL:          ${recordUrl(client, TABLE, sys_id)}`,
        ];
        const warnings = typeValueWarnings(type as string, value as string);
        if (warnings.length) lines.push('', ...warnings);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_property',
    {
      access: 'write',
      title: 'Update System Property',
      description: [
        'Updates an existing sys_properties record, located by its `name` (the',
        'natural key — the name itself is not changed). Pass only the fields you',
        'want to change; omitted fields stay as-is.',
        '',
        'When you change `value` without passing `type`, the existing stored type',
        'is used to sanity-check the new value.',
      ].join('\n'),
      inputSchema: PropertyUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const name = input.name as string;

        const existing = await client.listRecords<SnRecord>(
          TABLE,
          `name=${name}`,
          ['sys_id', 'type', 'value'],
          1,
        );
        if (existing.length === 0) {
          return errText(
            `No system property named "${name}" exists. Use create_property ` +
              'to create it.',
          );
        }
        const sys_id = val(existing[0], 'sys_id');

        const body = serializeFields(input, PROPERTY_UPDATE_FIELDS);
        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        const lines = [
          'System property updated successfully.',
          '',
          `name:           ${name}`,
          `sys_id:         ${sys_id}`,
          `Updated fields: ${Object.keys(body).join(', ')}`,
        ];
        // Validate against the new type if supplied, else the stored type.
        const effectiveType =
          (input.type as string | undefined) ?? val(existing[0], 'type');
        const warnings = typeValueWarnings(
          effectiveType,
          input.value as string | undefined,
        );
        if (warnings.length) lines.push('', ...warnings);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_properties',
    {
      access: 'read',
      title: 'List System Properties',
      description: [
        'Lists sys_properties records, optionally filtered by a name substring',
        'and/or type. Ordered by name.',
      ].join('\n'),
      inputSchema: PropertyList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, type, limit }) => {
      try {
        const clauses: string[] = [];
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        if (type) clauses.push(`type=${type}`);
        clauses.push('ORDERBYname');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          ['sys_id', 'name', 'type', 'value', 'is_private'],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const priv =
                  val(r, 'is_private') === 'true' ? ' (private)' : '';
                const rawValue = val(r, 'value');
                const value =
                  rawValue.length > 60
                    ? `${rawValue.slice(0, 57)}...`
                    : rawValue || '(empty)';
                return (
                  `${val(r, 'name')} [${val(r, 'type') || 'string'}]${priv} = ` +
                  `${value} — ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No system properties matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_property',
    {
      access: 'read',
      title: 'Get System Property',
      description: [
        'Reads a single sys_properties record by its exact `name`: its value,',
        'type, privacy/cache flags, and read/write role gates.',
      ].join('\n'),
      inputSchema: PropertyGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        const rows = await client.listRecords<SnRecord>(
          TABLE,
          `name=${name}`,
          undefined,
          1,
        );
        if (rows.length === 0) {
          return errText(`No system property named "${name}" exists.`);
        }
        const base = rows[0];
        const sys_id = val(base, 'sys_id');

        const result = {
          sys_id,
          name: val(base, 'name'),
          type: val(base, 'type') || 'string',
          value: val(base, 'value'),
          description: val(base, 'description'),
          suffix: val(base, 'suffix'),
          is_private: val(base, 'is_private') === 'true',
          ignore_cache: val(base, 'ignore_cache') === 'true',
          read_roles: val(base, 'read_roles'),
          write_roles: val(base, 'write_roles'),
          url: recordUrl(client, TABLE, sys_id),
        };

        const summary = [
          `System Property: ${result.name} (${result.sys_id})`,
          `Type:   ${result.type}${result.is_private ? ' · private' : ''}${
            result.ignore_cache ? ' · ignore_cache' : ''
          }`,
          `Value:  ${result.value || '(empty)'}`,
          `Read:   ${result.read_roles || '(no role restriction)'}`,
          `Write:  ${result.write_roles || '(no role restriction)'}`,
          `URL:    ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
