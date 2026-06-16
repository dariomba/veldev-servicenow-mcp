import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord, SnReference } from '../../types/servicenow.js';
import {
  errText,
  handleError,
  recordUrl,
  requireSysId,
  resolveValue,
  richResult,
  serializeFields,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  EMAIL_SCRIPT_FIELDS,
  EmailScriptCreate,
  EmailScriptGet,
  EmailScriptList,
  EmailScriptUpdate,
} from './schemas.js';

const TABLE = 'sys_script_email';

const RUNTIME_NOTE = [
  'INVOCATION: embed in a notification/template body as ${mail_script:<name>}.',
  'At send time ServiceNow runs the script and splices its printed output where',
  'the token sits.',
  '',
  'OUTPUT: write with template.print("<html>...") — the return value is ignored.',
  'IN SCOPE: current (target GlideRecord), template (TemplatePrinter), email',
  '(EmailOutbound, e.g. email.addAddress), email_action, event (event.parm1/parm2), gs.',
].join('\n');

export function registerEmailScriptTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_email_script',
    {
      access: 'write',
      title: 'Create Email Script',
      description: [
        'Creates a sys_script_email record — a reusable mail script embedded in a',
        'notification or email-template body via ${mail_script:<name>}.',
        '',
        RUNTIME_NOTE,
        '',
        'Wrap the body as:',
        '(function runMailScript(current, template, email, email_action, event) {',
        '  template.print("...");',
        '})(current, template, email, email_action, event);',
        '',
        'Idempotent: an existing email script with the same name is returned unchanged.',
      ].join('\n'),
      inputSchema: EmailScriptCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { name } = input;

        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `name=${name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return textResult(
            [
              'Email script already exists — skipped.',
              '',
              `name:   ${name}`,
              `sys_id: ${resolveValue(existing[0].sys_id)}`,
            ].join('\n'),
          );
        }

        const body = serializeFields(input, EMAIL_SCRIPT_FIELDS);
        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        return textResult(
          [
            'Email script created.',
            '',
            `name:   ${name}`,
            `sys_id: ${sys_id}`,
            `URL:    ${recordUrl(client, TABLE, sys_id)}`,
            '',
            `Reference it from a notification body as \${mail_script:${name}}.`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_email_script',
    {
      access: 'write',
      title: 'Update Email Script',
      description: [
        'Updates fields on an existing sys_script_email record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
        '',
        'Renaming changes the ${mail_script:<name>} token every referencing',
        'notification/template body must use — update those bodies too.',
      ].join('\n'),
      inputSchema: EmailScriptUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const sys_id = input.sys_id as string;
        const idErr = requireSysId(sys_id, 'sys_script_email sys_id');
        if (idErr) return errText(idErr);

        const body = serializeFields(input, EMAIL_SCRIPT_FIELDS);
        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        const lines = [
          'Email script updated successfully.',
          '',
          `sys_id:         ${sys_id}`,
          `Updated fields: ${Object.keys(body).join(', ')}`,
        ];
        if (body.name !== undefined) {
          lines.push(
            '',
            `Renamed — update any notification body referencing it to ` +
              `\${mail_script:${body.name}}.`,
          );
        }

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_email_scripts',
    {
      access: 'read',
      title: 'List Email Scripts',
      description: [
        'Lists sys_script_email records, optionally filtered by name substring.',
        'Use the name as the ${mail_script:<name>} token in a notification body.',
      ].join('\n'),
      inputSchema: EmailScriptList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, limit }) => {
      try {
        const clauses: string[] = [];
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        clauses.push('ORDERBYname');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          ['sys_id', 'name', 'new_lines_to_html'],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => `${val(r, 'name')} — ${val(r, 'sys_id')}`)
              .join('\n')
          : 'No email scripts matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_email_script',
    {
      access: 'read',
      title: 'Get Email Script',
      description: [
        'Reads a single sys_script_email record: its name (the ${mail_script:<name>}',
        'token) and the server-side script body that prints into the email.',
      ].join('\n'),
      inputSchema: EmailScriptGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const idErr = requireSysId(sys_id, 'sys_script_email sys_id');
        if (idErr) return errText(idErr);

        const base = await client.getRecord<SnRecord>(TABLE, sys_id);

        const result = {
          sys_id: val(base, 'sys_id'),
          name: val(base, 'name'),
          new_lines_to_html: val(base, 'new_lines_to_html') === 'true',
          script: val(base, 'script'),
          url: recordUrl(client, TABLE, sys_id),
        };

        const summary = [
          `Email Script: ${result.name} (${result.sys_id})`,
          `Invoke as:    \${mail_script:${result.name}}`,
          `Newlines→HTML: ${result.new_lines_to_html}`,
          `Script:       ${
            result.script ? `${result.script.length} chars` : '(none)'
          }`,
          `URL:          ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
