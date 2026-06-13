import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import {
  errText,
  handleError,
  requireSysId,
  resolveValue,
  textResult,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import { FixScriptCreate, FixScriptRun, FixScriptUpdate } from './schemas.js';

export function registerFixScriptTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_fix_script',
    {
      access: 'write',
      title: 'Create Fix Script',
      description: [
        'Creates a sys_script_fix record in ServiceNow.',
        '',
        'Fix scripts are stored server-side JavaScript snippets that can be executed',
        'on demand to repair data or configuration issues. Unlike background scripts,',
        'fix scripts are persisted in the database and can be re-run at any time.',
        '',
        'Idempotent: if a fix script with the same name already exists, returns its',
        'sys_id without creating a duplicate.',
        '',
        'Returns the sys_id and name of the created record.',
      ].join('\n'),
      inputSchema: FixScriptCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      name,
      description,
      script,
      record_for_rollback,
      before,
      unloadable,
    }) => {
      try {
        const existing = await client.listRecords<{ sys_id: SnReference }>(
          'sys_script_fix',
          `name=${name}`,
          ['sys_id'],
          1,
        );

        if (existing.length > 0) {
          const sys_id = resolveValue(existing[0].sys_id);
          return textResult(
            [
              `Fix Script "${name}" already exists — skipped.`,
              `sys_id: ${sys_id}`,
            ].join('\n'),
          );
        }

        const body: Record<string, unknown> = {
          name,
          script,
          record_for_rollback: String(record_for_rollback),
          before: String(before),
          unloadable: String(unloadable),
        };
        if (description !== undefined) body.description = description;

        const record = await client.createRecord<{
          sys_id: SnReference;
          name: SnReference;
        }>('sys_script_fix', body);

        const sys_id = resolveValue(record.sys_id);

        return textResult(
          [
            `Fix Script created.`,
            ``,
            `Name:                ${name}`,
            `sys_id:              ${sys_id}`,
            `record_for_rollback: ${record_for_rollback}`,
            `before:              ${before}`,
            `unloadable:          ${unloadable}`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_fix_script',
    {
      access: 'write',
      title: 'Update Fix Script',
      description: [
        'Updates fields on an existing sys_script_fix record.',
        '',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
        'Requires the sys_id of the fix script to update.',
      ].join('\n'),
      inputSchema: FixScriptUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      description,
      script,
      record_for_rollback,
      before,
      unloadable,
    }) => {
      try {
        const err = requireSysId(sys_id, 'Fix Script sys_id');
        if (err) return errText(err);

        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (script !== undefined) body.script = script;
        if (record_for_rollback !== undefined)
          body.record_for_rollback = String(record_for_rollback);
        if (before !== undefined) body.before = String(before);
        if (unloadable !== undefined) body.unloadable = String(unloadable);

        await client.patchRecord<unknown>('sys_script_fix', sys_id, body);

        return textResult(
          [
            `Fix Script updated successfully.`,
            ``,
            `sys_id:         ${sys_id}`,
            `Updated fields: ${Object.keys(body).join(', ') || 'none'}`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'run_fix_script',
    {
      access: 'write',
      title: 'Run Fix Script',
      description: [
        'Executes a stored fix script (sys_script_fix) by scheduling it via a background trigger.',
        '',
        'Retrieves the fix script from the database by sys_id and runs its script body',
        'using GlideScopedEvaluator via a sys_trigger that fires ~1 second after creation.',
        '',
        'Returns the trigger sys_id, name, and scheduled execution time.',
      ].join('\n'),
      inputSchema: FixScriptRun,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ sys_id }) => {
      try {
        const err = requireSysId(sys_id, 'Fix Script sys_id');
        if (err) return errText(err);

        // Build a runner that executes the stored fix script via GlideScopedEvaluator,
        // matching the same mechanism ServiceNow uses when running a fix script from the UI.
        const runnerScript = [
          `var gr = new GlideRecord('sys_script_fix');`,
          `if (gr.get('${sys_id}')) {`,
          `    var evaluator = new GlideScopedEvaluator();`,
          `    evaluator.evaluateScript(gr, 'script');`,
          `}`,
        ].join('\n');

        const result =
          await client.executeBackgroundScriptTrigger(runnerScript);

        return textResult(
          [
            `Fix Script execution scheduled.`,
            ``,
            `fix_script_sys_id: ${sys_id}`,
            `trigger_sys_id:    ${result.trigger_sys_id}`,
            `trigger_name:      ${result.trigger_name}`,
            `next_action:       ${result.next_action}`,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
