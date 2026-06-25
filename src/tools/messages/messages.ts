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
  MESSAGE_FIELDS,
  MESSAGE_UPDATE_FIELDS,
  MessageCreate,
  MessageGet,
  MessageList,
  MessageUpdate,
} from './schemas.js';

const TABLE = 'sys_ui_message';

/** Reminds the caller that translations are per-language, one record each. */
function perLanguageNote(key: string, language: string): string {
  return (
    `Note: messages are per-language — "${key}" is stored for "${language}" ` +
    'only. Create the same key again with a different `language` to translate it.'
  );
}

export function registerMessageTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_message',
    {
      access: 'write',
      title: 'Create UI Message',
      description: [
        'Creates a sys_ui_message record — localizable text looked up at runtime',
        'with gs.getMessage(key) (server) or getMessage(key) (client).',
        '',
        'Localization is per-language: the same `key` has a separate record for',
        'each `language`. `key`+`language` together identify the record. Defaults',
        'language to "en".',
        '',
        'Idempotent: an existing message with the same key+language is returned',
        'unchanged. Use update_message to change the text.',
      ].join('\n'),
      inputSchema: MessageCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { key, message } = input;
        const language = (input.language as string) ?? 'en';

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `key=${key}^language=${language}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return textResult(
            [
              'UI message already exists for this key+language — skipped.',
              '',
              `key:      ${key}`,
              `language: ${language}`,
              `sys_id:   ${resolveValue(existing[0].sys_id)}`,
              '',
              'Use update_message to change the text.',
            ].join('\n'),
          );
        }

        const body = serializeFields(input, MESSAGE_FIELDS);
        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        return textResult(
          [
            'UI message created.',
            '',
            `key:      ${key}`,
            `language: ${language}`,
            `message:  ${message}`,
            `sys_id:   ${sys_id}`,
            `URL:      ${recordUrl(client, TABLE, sys_id)}`,
            '',
            perLanguageNote(key as string, language),
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_message',
    {
      access: 'write',
      title: 'Update UI Message',
      description: [
        'Updates the text of an existing sys_ui_message record, located by',
        '`key`+`language` (defaults language to "en"). Pass `message` with the',
        'new text.',
        '',
        'The same key in another language is a different record — update each',
        'language separately.',
      ].join('\n'),
      inputSchema: MessageUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const key = input.key as string;
        const language = (input.language as string) ?? 'en';

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `key=${key}^language=${language}`,
          ['sys_id'],
          1,
        );
        if (existing.length === 0) {
          return errText(
            `No UI message with key "${key}" exists for language "${language}". ` +
              'Use create_message to create it.',
          );
        }
        const sys_id = resolveValue(existing[0].sys_id);

        const body = serializeFields(input, MESSAGE_UPDATE_FIELDS);
        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        return textResult(
          [
            'UI message updated successfully.',
            '',
            `key:            ${key}`,
            `language:       ${language}`,
            `sys_id:         ${sys_id}`,
            `Updated fields: ${Object.keys(body).join(', ')}`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_messages',
    {
      access: 'read',
      title: 'List UI Messages',
      description: [
        'Lists sys_ui_message records, optionally filtered by a key substring',
        'and/or language. Ordered by key then language.',
      ].join('\n'),
      inputSchema: MessageList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ key_contains, language, limit }) => {
      try {
        const clauses: string[] = [];
        if (key_contains) clauses.push(`keyLIKE${key_contains}`);
        if (language) clauses.push(`language=${language}`);
        clauses.push('ORDERBYkey', 'ORDERBYlanguage');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          ['sys_id', 'key', 'language', 'message'],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const rawMsg = val(r, 'message');
                const msg =
                  rawMsg.length > 60
                    ? `${rawMsg.slice(0, 57)}...`
                    : rawMsg || '(empty)';
                return (
                  `[${val(r, 'language') || 'en'}] ${val(r, 'key')} = ${msg} ` +
                  `— ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No UI messages matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_message',
    {
      access: 'read',
      title: 'Get UI Message',
      description: [
        'Reads a single sys_ui_message record by `key`+`language` (defaults',
        'language to "en"): its translated text.',
      ].join('\n'),
      inputSchema: MessageGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ key, language }) => {
      try {
        const lang = language ?? 'en';
        const rows = await client.listRecords<SnRecord>(
          TABLE,
          `key=${key}^language=${lang}`,
          undefined,
          1,
        );
        if (rows.length === 0) {
          return errText(
            `No UI message with key "${key}" exists for language "${lang}".`,
          );
        }
        const base = rows[0];
        const sys_id = val(base, 'sys_id');

        const result = {
          sys_id,
          key: val(base, 'key'),
          language: val(base, 'language') || 'en',
          message: val(base, 'message'),
          url: recordUrl(client, TABLE, sys_id),
        };

        const summary = [
          `UI Message: ${result.key} (${result.sys_id})`,
          `Language: ${result.language}`,
          `Message:  ${result.message || '(empty)'}`,
          `URL:      ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
