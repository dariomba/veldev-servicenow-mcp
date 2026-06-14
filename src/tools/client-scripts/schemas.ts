import { z } from 'zod';

const ClientScriptBase = z.object({
  name: z.string().min(1).describe('Name of the client script.'),
  table: z
    .string()
    .min(1)
    .describe(
      "Internal name of the table the script runs on, e.g. 'incident' — NOT the label. " +
        'Best practice: scope client scripts to a single table; keep them short and focused.',
    ),
  type: z
    .enum(['onLoad', 'onChange', 'onSubmit', 'onCellEdit'])
    .describe(
      'When the script fires. ' +
        'onLoad=once when the form renders (set defaults, read-only/mandatory state); ' +
        'onChange=a specific field changes — requires field; ' +
        'onSubmit=on form submit — return false to abort the save; ' +
        'onCellEdit=inline edit of a cell in a list — requires field.',
    ),
  field: z
    .string()
    .optional()
    .describe(
      'Internal name of the field to watch. ' +
        "REQUIRED when type is 'onChange' or 'onCellEdit'; ignored for onLoad/onSubmit.",
    ),
  script: z
    .string()
    .min(1)
    .describe(
      'Client-side JavaScript. Use the standard signature for the type, e.g. ' +
        'onChange(control, oldValue, newValue, isLoading, isTemplate) — return early when isLoading is true. ' +
        'Use the g_form / g_user API. Never make synchronous server calls: use GlideAjax getXMLAnswer() ' +
        'or async GlideRecord. When setting a reference field, set its display value at the same time ' +
        'to avoid an extra server round-trip.',
    ),
  active: z.boolean().optional().describe('Whether the script is active.'),
  ui_type: z
    .enum(['desktop', 'mobile', 'all'])
    .optional()
    .describe(
      "Where the script applies: 'desktop' (platform UI), " +
        "'mobile' (mobile / Service Portal), or 'all' (both).",
    ),
  global: z
    .boolean()
    .optional()
    .describe(
      'When true the script applies across all form views. ' +
        'Set false to limit it to one view, then set view.',
    ),
  view: z
    .string()
    .optional()
    .describe(
      'Form view the script is limited to. Only used when global=false.',
    ),
  applies_extended: z
    .boolean()
    .optional()
    .describe(
      'When true the script is inherited by tables that extend this table (the "Inherited" flag).',
    ),
  isolate_script: z
    .boolean()
    .optional()
    .describe(
      'Run the script in an isolated scope with no access to the global window/DOM. ' +
        'Keep true (the secure, recommended default); set false only for legacy scripts that need window globals.',
    ),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Execution sequence among scripts of the same type on the table. Lower runs first.',
    ),
  description: z
    .string()
    .optional()
    .describe('Optional description of what the script does.'),
  messages: z
    .string()
    .optional()
    .describe(
      'Newline-separated messages to pre-register for getMessage() lookups on the client.',
    ),
});

export const ClientScriptCreate = ClientScriptBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the script is active. Defaults to true.'),
  ui_type: z
    .enum(['desktop', 'mobile', 'all'])
    .optional()
    .default('all')
    .describe(
      "Where the script applies: 'desktop' (platform UI), " +
        "'mobile' (mobile / Service Portal), or 'all' (both). Defaults to 'all'.",
    ),
  global: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true the script applies across all form views. ' +
        'Set false to limit it to one view, then set view. Defaults to true.',
    ),
  applies_extended: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true the script is inherited by tables that extend this table. Defaults to false.',
    ),
  isolate_script: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Run the script in an isolated scope with no access to the global window/DOM. ' +
        'Defaults to true (secure default); set false only for legacy scripts that need window globals.',
    ),
});

export const ClientScriptUpdate = ClientScriptBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_client record to update.'),
});
