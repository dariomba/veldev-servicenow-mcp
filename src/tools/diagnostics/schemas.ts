import { z } from 'zod';

// ── Fix Script ────────────────────────────────────────────────────────────────

const FixScriptBase = z.object({
  name: z.string().min(1).describe('Display name of the fix script.'),
  description: z
    .string()
    .optional()
    .describe('Description of what the fix script does.'),
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript to execute. Runs in the global scope with full access to ' +
        'GlideRecord, gs, and all server-side APIs. ' +
        'Do NOT call current.update() — fix scripts run outside of a record context.',
    ),
  record_for_rollback: z
    .boolean()
    .optional()
    .describe(
      'When true, a rollback record is created so the fix script can be reverted if needed.',
    ),
  before: z
    .boolean()
    .optional()
    .describe(
      'When true, the fix script runs before the upgrade data migration. ' +
        'Defaults to false (runs after the upgrade).',
    ),
  unloadable: z
    .boolean()
    .optional()
    .describe('When true, the fix script can be unloaded from the instance.'),
});

export const FixScriptCreate = FixScriptBase.extend({
  record_for_rollback: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true, a rollback record is created so the fix script can be reverted. Defaults to true.',
    ),
  before: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, the fix script runs before the upgrade data migration. Defaults to false.',
    ),
  unloadable: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, the fix script can be unloaded from the instance. Defaults to false.',
    ),
});

export const FixScriptUpdate = FixScriptBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_fix record to update.'),
});

export const FixScriptRun = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_fix record to execute.'),
});

// ── Background Script ─────────────────────────────────────────────────────────

export const BackgroundScriptExecute = z.object({
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript to execute as a background script. ' +
        'Uses GlideRecord, gs, and other server-side APIs. ' +
        'The script runs in the global scope — no function wrapper needed.',
    ),
});
