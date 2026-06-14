import { z } from 'zod';

// ── Form / Table UI Policy (sys_ui_policy) ──────────────────────────────────
//
// These are the classic UI Policies that run on table forms — distinct from
// catalog_ui_policy (catalog item forms), which lives in the `catalog` domain.
// Field shapes verified against the sys_ui_policy / sys_ui_policy_action
// dictionaries on the PDI.

/** Friendly enum → sys_ui_policy.ui_type choice code. */
export const UI_TYPE_CODE: Record<string, string> = {
  desktop: '0',
  mobile: '1',
  all: '10',
};

const UiPolicyBase = z.object({
  short_description: z
    .string()
    .min(1)
    .max(255)
    .describe(
      'Human-readable label for the policy. UI Policies have no name field, ' +
        'so this is how the policy is identified when debugging. Required.',
    ),
  table: z
    .string()
    .min(1)
    .describe(
      "Internal name of the table the policy runs on, e.g. 'incident'. " +
        'Use resolve_table if unsure of the exact name.',
    ),
  conditions: z
    .string()
    .optional()
    .describe(
      'Encoded query that gates when the policy applies, e.g. ' +
        "'priority=1^state=2'. Leave empty to always apply (on_load only).",
    ),
  active: z.boolean().optional().describe('Whether the policy is active.'),
  on_load: z
    .boolean()
    .optional()
    .describe('Run the policy when the form loads, not only on field change.'),
  reverse_if_false: z
    .boolean()
    .optional()
    .describe(
      'Reverse the policy actions when the condition evaluates to false. ' +
        'Keep true unless you intend the actions to stick.',
    ),
  run_scripts: z
    .boolean()
    .optional()
    .describe(
      'Enable the Execute if true / Execute if false client scripts. ' +
        'Leave false for declarative field-only policies.',
    ),
  global: z
    .boolean()
    .optional()
    .describe(
      'Run on every view of the table. Set false to scope to a single view ' +
        '(then set `view`).',
    ),
  inherit: z
    .boolean()
    .optional()
    .describe(
      'Also apply the policy to tables that extend `table` ' +
        '(e.g. a task policy applying to incident).',
    ),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Execution order. Lower runs first / wins on conflicting fields. ' +
        'Default 100.',
    ),
  ui_type: z
    .enum(['desktop', 'mobile', 'all'])
    .optional()
    .describe(
      "Which interfaces the policy runs on: 'desktop', 'mobile' " +
        "(Mobile / Service Portal), or 'all'.",
    ),
  view: z
    .string()
    .optional()
    .describe(
      'sys_id of the sys_ui_view to scope to. Only used when global=false.',
    ),
  description: z
    .string()
    .optional()
    .describe('Longer free-text description of the policy.'),
  script_true: z
    .string()
    .optional()
    .describe(
      'Client script body run when the condition is true. ' +
        'Only used when run_scripts=true.',
    ),
  script_false: z
    .string()
    .optional()
    .describe(
      'Client script body run when the condition is false. ' +
        'Only used when run_scripts=true.',
    ),
  isolate_script: z
    .boolean()
    .optional()
    .describe(
      'Run the scripts in an isolated (strict) scope. Only relevant when ' +
        'run_scripts=true.',
    ),
});

export const UiPolicyCreate = UiPolicyBase.extend({
  active: z.boolean().optional().default(true).describe('Defaults to true.'),
  on_load: z.boolean().optional().default(true).describe('Defaults to true.'),
  reverse_if_false: z
    .boolean()
    .optional()
    .default(true)
    .describe('Defaults to true.'),
  run_scripts: z
    .boolean()
    .optional()
    .default(false)
    .describe('Defaults to false.'),
  global: z.boolean().optional().default(true).describe('Defaults to true.'),
  inherit: z.boolean().optional().default(false).describe('Defaults to false.'),
  order: z.number().int().optional().default(100).describe('Defaults to 100.'),
  ui_type: z
    .enum(['desktop', 'mobile', 'all'])
    .optional()
    .default('all')
    .describe(
      "Defaults to 'all' so the policy runs on both desktop and Service Portal.",
    ),
});

export const UiPolicyUpdate = UiPolicyBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_ui_policy record to update.'),
});

export const UiPolicyList = z.object({
  table: z
    .string()
    .optional()
    .describe('Filter to policies running on this table.'),
  short_description_contains: z
    .string()
    .optional()
    .describe('Filter to policies whose short description contains this text.'),
  active: z
    .boolean()
    .optional()
    .describe('Filter by active flag. Omit to return both.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of policies to return (1–100). Defaults to 50.'),
});

export const UiPolicyGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_ui_policy record to read.'),
});

// ── UI Policy Action (sys_ui_policy_action) ─────────────────────────────────

const UiPolicyActionBase = z.object({
  ui_policy: z
    .string()
    .min(1)
    .describe('sys_id of the parent sys_ui_policy record.'),
  field: z
    .string()
    .min(1)
    .describe(
      "Internal name of the field the action targets, e.g. 'assigned_to'.",
    ),
  table: z
    .string()
    .optional()
    .describe(
      "Table the field lives on. Omit to inherit the parent policy's table.",
    ),
  visible: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe("Make the field visible. 'ignore' = leave alone."),
  mandatory: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe(
      "Make the field mandatory. NEVER set 'true' together with disabled='true'.",
    ),
  disabled: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe(
      "Make the field read-only. NEVER set 'true' together with mandatory='true'.",
    ),
  value_action: z
    .enum(['clear_value', 'set_value', 'ignore'])
    .optional()
    .describe(
      "What to do with the field value: 'set_value' sets it, 'clear_value' " +
        "empties it, 'ignore' leaves it alone.",
    ),
  value: z
    .string()
    .optional()
    .describe("Value to set. Only used when value_action='set_value'."),
  field_message_type: z
    .enum(['error', 'info', 'warning', 'none'])
    .optional()
    .describe("Type of inline message on the field. 'none' shows no message."),
  field_message: z
    .string()
    .optional()
    .describe(
      "Message text shown on the field. Required when field_message_type isn't 'none'.",
    ),
});

export const UiPolicyActionCreate = UiPolicyActionBase.extend({
  visible: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe("Defaults to 'ignore' (leave alone)."),
  mandatory: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe(
      "Defaults to 'ignore'. NEVER 'true' together with disabled='true'.",
    ),
  disabled: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe(
      "Defaults to 'ignore'. NEVER 'true' together with mandatory='true'.",
    ),
  value_action: z
    .enum(['clear_value', 'set_value', 'ignore'])
    .optional()
    .default('ignore')
    .describe("Defaults to 'ignore'."),
  field_message_type: z
    .enum(['error', 'info', 'warning', 'none'])
    .optional()
    .default('none')
    .describe("Defaults to 'none'."),
});

export const UiPolicyActionUpdate = UiPolicyActionBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_ui_policy_action record to update.'),
});

// ── UI Policy Related List Action (sys_ui_policy_rl_action) ──────────────────
//
// Sibling of sys_ui_policy_action but for related lists: the only effect is
// showing / hiding a related list — there is no mandatory / read-only / value.

const UiPolicyRlActionBase = z.object({
  ui_policy: z
    .string()
    .min(1)
    .describe('sys_id of the parent sys_ui_policy record.'),
  list: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Identifier of the related list to control. Two formats: ' +
        "'<table>.<field>' (the related table and the field pointing back, " +
        "e.g. 'task.parent') or 'REL:<sys_relationship_sys_id>' for a defined " +
        'relationship.',
    ),
  visible: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe(
      "Show or hide the related list. 'ignore' = leave alone. " +
        '(Related lists only support visibility — nothing else.)',
    ),
});

export const UiPolicyRlActionCreate = UiPolicyRlActionBase.extend({
  visible: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe("Defaults to 'ignore' (leave alone)."),
});

export const UiPolicyRlActionUpdate = UiPolicyRlActionBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_ui_policy_rl_action record to update.'),
});
