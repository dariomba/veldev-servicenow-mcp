import { z } from 'zod';

// ── Script Include ─────────────────────────────────────────────────────

const ScriptIncludeBase = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Class name of the Script Include. Must be a valid JavaScript identifier, ' +
        "e.g. 'CatalogAjaxUtils'. Used as both the record name and class name in the script.",
    ),
  script: z
    .string()
    .min(1)
    .describe(
      'Full JavaScript body of the Script Include. For client-callable scripts, ' +
        'must define a class that extends AbstractAjaxProcessor.',
    ),
  client_callable: z
    .boolean()
    .optional()
    .describe(
      'Set to true if this Script Include will be called from the client via GlideAjax.',
    ),
  access: z
    .enum(['public', 'package_private'])
    .optional()
    .describe(
      "'public' makes the Script Include callable from any scope (required for GlideAjax). " +
        "'package_private' restricts it to the same application scope.",
    ),
  description: z
    .string()
    .optional()
    .describe('Optional description of what this Script Include does.'),
  active: z
    .boolean()
    .optional()
    .describe('Whether the Script Include is active.'),
});

export const ScriptIncludeCreate = ScriptIncludeBase.extend({
  client_callable: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Set to true if this Script Include will be called from the client via GlideAjax. ' +
        'Defaults to false.',
    ),
  access: z
    .enum(['public', 'package_private'])
    .optional()
    .default('public')
    .describe(
      "'public' makes the Script Include callable from any scope (required for GlideAjax). " +
        "'package_private' restricts it to the same application scope. Defaults to 'public'.",
    ),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the Script Include is active. Defaults to true.'),
});

export const ScriptIncludeUpdate = ScriptIncludeBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the script include record to update.'),
});

//Business Rule ───────────────────────────────────────────────────────────────

const BusinessRuleBase = z.object({
  name: z.string().min(1).describe('Name of the business rule.'),
  collection: z
    .string()
    .min(1)
    .describe("Internal table name the rule runs on, e.g. 'incident'."),
  active: z.boolean().optional().describe('Whether the rule is active.'),
  advanced: z
    .boolean()
    .optional()
    .describe(
      'Enables When, Order, Delete, Query, Condition and Script fields. ' +
        'Default to true whenever a script or specific timing is needed.',
    ),

  // When to run — always present
  action_insert: z.boolean().optional().describe('Trigger on record insert.'),
  action_update: z.boolean().optional().describe('Trigger on record update.'),

  // Advanced only — omit when advanced=false
  when: z
    .enum(['before', 'after', 'async_always', 'display'])
    .optional()
    .describe(
      'When to run relative to the DB operation. ' +
        'before=before write, after=after write, async_always=async job, display=before form render. ' +
        'Advanced only. Omit when advanced=false.',
    ),
  order: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Execution sequence among rules on the same table. Lower runs first. Advanced only.',
    ),
  action_delete: z
    .boolean()
    .optional()
    .describe(
      'Trigger on record delete. Advanced only. Send as false when advanced=false.',
    ),
  action_query: z
    .boolean()
    .optional()
    .describe(
      'Trigger on table query. Advanced only. Send as false when advanced=false.',
    ),
  filter_condition: z
    .string()
    .optional()
    .describe(
      'DEFAULT FIELD for any trigger condition based on field values. ' +
        "Encoded query syntax, e.g. 'priority=1^active=true^category=hardware'. " +
        'Use this whenever the rule should only fire for records matching certain field values. ' +
        'NEVER use the condition field for field comparisons — put them here. ' +
        "To fire only when a field changes, use the VALCHANGES operator: e.g. 'assignment_groupVALCHANGES'. " +
        "To fire when a field changes to a specific value: 'assignment_groupCHANGESTO<sys_id>'. " +
        "To fire when a field changes from a specific value: 'assignment_groupCHANGESFROM<sys_id>'.",
    ),
  role_conditions: z
    .string()
    .optional()
    .describe('Comma-separated role names required to trigger the rule.'),

  // Actions — always present
  template: z
    .string()
    .optional()
    .describe('Set field values syntax. Never combine with abort_action=true.'),
  add_message: z
    .boolean()
    .optional()
    .describe('Show a message to the user when the rule runs.'),
  abort_action: z
    .boolean()
    .optional()
    .describe(
      'Abort the current DB transaction. Only valid in before rules. ' +
        'Never combine with template or script.',
    ),

  // Advanced only
  condition: z
    .string()
    .optional()
    .describe(
      'JavaScript boolean expression. Advanced only. ' +
        'NEVER use this for field value comparisons — those belong in filter_condition. ' +
        'Only set this when the logic requires gs methods or multi-step calculations ' +
        'that CANNOT be expressed as an encoded query, e.g. \'gs.hasRole("admin")\' or \'current.getValue("field").length > 10\'. ' +
        'If you are checking a field value, use filter_condition instead.',
    ),
  script: z
    .string()
    .optional()
    .describe(
      'Server-side JavaScript wrapped in the standard ServiceNow IIFE: ' +
        "'(function executeRule(current, previous /*null when async*/) { ... })(current, previous);'. " +
        'Never call current.update() inside the script. Advanced only. Never combine with abort_action=true. ' +
        'when=async_always: previous is always null — never read from it. ' +
        "when=display: use g_scratchpad to pass values to the client (g_scratchpad.myKey = current.getValue('field')).",
    ),
});

export const BusinessRuleCreate = BusinessRuleBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the rule is active. Defaults to true.'),
  advanced: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Enables When, Order, Delete, Query, Condition and Script fields. ' +
        'Default to true whenever a script or specific timing is needed. Defaults to false.',
    ),
  action_insert: z
    .boolean()
    .optional()
    .default(false)
    .describe('Trigger on record insert. Defaults to false.'),
  action_update: z
    .boolean()
    .optional()
    .default(false)
    .describe('Trigger on record update. Defaults to false.'),
  action_delete: z
    .boolean()
    .optional()
    .default(false)
    .describe('Trigger on record delete. Advanced only. Defaults to false.'),
  action_query: z
    .boolean()
    .optional()
    .default(false)
    .describe('Trigger on table query. Advanced only. Defaults to false.'),
});

export const BusinessRuleUpdate = BusinessRuleBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script record to update.'),
});

// ── Client Script ──────────────────────────────────────────────────────

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
