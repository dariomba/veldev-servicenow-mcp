import { z } from 'zod';
import { VARIABLE_TYPE_MAP } from '../types/servicenow.js';

export const VARIABLE_TYPES_HINT = Object.entries(VARIABLE_TYPE_MAP)
  .map(([k, v]) => `${k}=${v}`)
  .join(', ');

const ChoiceItem = z.object({
  text: z.string().min(1).describe('Display label shown to the user.'),
  value: z.string().describe('Value stored when this choice is selected.'),
  order: z
    .number()
    .int()
    .optional()
    .describe('Display order. Defaults to 100.'),
});

const ChoiceItemUpdate = z.object({
  sys_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'sys_id of the existing question_choice record to update. ' +
        'Omit to create a new choice instead.',
    ),
  text: z.string().min(1).describe('Display label shown to the user.'),
  value: z.string().describe('Value stored when this choice is selected.'),
  order: z
    .number()
    .int()
    .optional()
    .describe('Display order. Defaults to (index + 1) * 100.'),
});

// ── Catalog Item ─────────────────────────────────────────────────────────────

const CatalogItemBase = z.object({
  name: z.string().min(1).describe('Display name of the catalog item.'),
  short_description: z
    .string()
    .optional()
    .describe('One-line summary shown in the catalog browse view.'),
  description: z
    .string()
    .optional()
    .describe(
      'Full description of the item, use simple strings, no HTML support.',
    ),
  catalog_sys_id: z
    .string()
    .optional()
    .describe(
      'sys_id of the Service Catalog this item belongs to (sc_catalog record). ' +
        'Call list_catalogs to look it up by name. ' +
        'If omitted the item is created without a catalog association.',
    ),
  category_sys_id: z
    .string()
    .optional()
    .describe(
      'sys_id of the category (sc_category record). ' +
        'Call list_catalog_categories to look it up by name.',
    ),
  active: z.boolean().optional().describe('Whether the item is active.'),
  order: z
    .number()
    .int()
    .optional()
    .describe('Sort order within the category.'),
  price: z
    .string()
    .optional()
    .describe("Price as a decimal string, e.g. '0' or '99.99'."),
  flow_designer_flow: z
    .string()
    .optional()
    .describe(
      'sys_id of the Flow Designer flow (sys_hub_flow) to run when this item is ordered. ' +
        'Call list_flows to look it up by name. ' +
        'Mutually exclusive with workflow — set only one.',
    ),
  workflow: z
    .string()
    .optional()
    .describe(
      'sys_id of the classic Workflow (wf_workflow) to run when this item is ordered. ' +
        'Call list_workflows to look it up by name. ' +
        'Mutually exclusive with flow_designer_flow — set only one.',
    ),
  request_method: z
    .enum(['', 'request', 'submit'])
    .optional()
    .describe(
      "Label shown on the submit button. '' = 'Order' (default), 'request' = 'Request', 'submit' = 'Submit'. " +
        'Only set when the user explicitly asks to change the button label.',
    ),
});

export const CatalogItemCreate = CatalogItemBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the item is active. Defaults to true.'),
  order: z
    .number()
    .int()
    .optional()
    .default(100)
    .describe('Sort order within the category. Defaults to 100.'),
});

export const CatalogItemUpdate = CatalogItemBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the catalog item (sc_cat_item) to update.'),
});

// ── Catalog Variable ──────────────────────────────────────────────────────────

const CatalogVariableBase = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Internal field name (no spaces, snake_case). Must be unique on the item.',
    ),
  question_text: z
    .string()
    .min(1)
    .describe('Label shown to the user on the request form.'),
  type: z
    .string()
    .min(1)
    .describe(
      `Numeric type code. Common values: 6=Single Line Text, 2=Multi Line Text, 3=Multiple Choice, 7=CheckBox, 8=Reference, 5=Select Box. Full list: ${VARIABLE_TYPES_HINT}`,
    ),
  mandatory: z.boolean().optional().describe('Whether the field is required.'),
  hidden: z
    .boolean()
    .optional()
    .describe(
      'Hidden variables are submitted with the request but not shown on the form.',
    ),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Display order on the form. Use ascending values across variables.',
    ),
  reference_table: z
    .string()
    .optional()
    .describe(
      "type=8 ONLY. Internal table name, e.g. 'sys_user_group'. Do NOT pass a sys_id. Call resolve_table if unsure. Must be null/omitted for all other types.",
    ),
  lookup_source: z
    .enum(['', 'choices'])
    .optional()
    .describe(
      "type=18 and type=22 ONLY. '' = Table mode. 'choices' = Choices mode. Omit for all other types.",
    ),
  lookup_table: z
    .string()
    .optional()
    .describe(
      "Table mode ONLY (lookup_source=''). Table to fetch records from. Call resolve_table if unsure.",
    ),
  lookup_value: z
    .string()
    .optional()
    .describe(
      "Table mode ONLY. Field from lookup_table whose value gets stored. Defaults to 'sys_id'.",
    ),
  lookup_label: z
    .string()
    .optional()
    .describe(
      'Table mode ONLY. Field from lookup_table shown in the dropdown.',
    ),
  lookup_unique: z
    .boolean()
    .optional()
    .describe('Table mode ONLY. When true, prevents duplicate selections.'),
  choice_table: z
    .string()
    .optional()
    .describe(
      "Choices mode ONLY (lookup_source='choices'). Table that contains the field whose choices to reuse.",
    ),
  choice_field: z
    .string()
    .optional()
    .describe(
      'Choices mode ONLY. Field on choice_table whose choices to reuse.',
    ),
  lookup_dependent_question: z
    .string()
    .optional()
    .describe(
      'Choices mode ONLY. sys_id of another variable on the same item that filters choices dynamically.',
    ),
  choice_direction: z
    .enum(['down', 'across'])
    .optional()
    .describe(
      "type=22 ONLY. 'down' = vertical (default). 'across' = horizontal. NEVER set for type=18 or any other type.",
    ),
  list_table: z
    .string()
    .optional()
    .describe(
      'type=21 ONLY. Internal table name whose records the user picks from. Must be null/omitted for all other types.',
    ),
  attributes: z
    .string()
    .optional()
    .describe(
      'Only set when the developer explicitly describes a visual or functional need. Never invent.',
    ),
  default_value: z.string().optional().describe('Fixed pre-filled value only.'),
  use_reference_qualifier: z
    .enum(['simple', 'advanced'])
    .optional()
    .describe(
      "Use 'simple' for straightforward encoded queries. Use 'advanced' for complex filters.",
    ),
  reference_qual_condition: z
    .string()
    .optional()
    .describe(
      "Simple encoded query filter, e.g. 'active=true^EQ'. Use when use_reference_qualifier='simple'. Do NOT use together with reference_qual.",
    ),
  reference_qual: z
    .string()
    .optional()
    .describe(
      "Advanced filter. Use when use_reference_qualifier='advanced'. Do NOT use together with reference_qual_condition. " +
        'Two sub-cases: ' +
        '(1) Complex encoded query (no server code needed): plain encoded query string, same format as reference_qual_condition. ' +
        '(2) Server-side Script Include call (GlideRecord or dynamic logic): ' +
        'javascript: new <scope>.<ScriptIncludeName>().<method>(current, <args>); ' +
        'The Script Include must already exist before this variable is created. ' +
        'It runs server-side and must NOT be client_callable. ' +
        'The method must return an encoded query string or sys_id list. ' +
        'NEVER inline a GlideRecord query here — always encapsulate in a Script Include.',
    ),
  help_text: z
    .string()
    .optional()
    .describe(
      'Shown next to the field. Only set show_help/show_help_on_load when this is provided.',
    ),
  show_help: z
    .boolean()
    .optional()
    .describe('Only set when help_text is provided.'),
  show_help_on_load: z
    .boolean()
    .optional()
    .describe('Only set when help_text is provided.'),
  tooltip: z
    .string()
    .optional()
    .describe(
      'Text shown when the user hovers over the field. Only set when explicitly described. Max 40 characters. If the text is longer, put a short label here and move the detail to help_text.',
    ),

  validate_regex: z
    .string()
    .optional()
    .describe(
      'Explicit format constraint only. Never guess. Always pair with validation_message.',
    ),
  validation_message: z
    .string()
    .optional()
    .describe(
      'Error message shown when validate_regex fails. Required whenever validate_regex is set.',
    ),
  dynamic_value_field: z
    .string()
    .optional()
    .describe(
      'sys_id of the source variable to auto-fill from. Pair with dynamic_value_dot_walk_path.',
    ),
  dynamic_value_dot_walk_path: z
    .string()
    .optional()
    .describe(
      "Dot-walk path for auto-fill, e.g. 'manager.email'. Only set when dynamic_value_field is set.",
    ),
  do_not_select_first: z
    .boolean()
    .optional()
    .describe(
      'Set to true only when the developer explicitly states that no option should be pre-selected.',
    ),
  include_none: z
    .boolean()
    .optional()
    .describe(
      "Set to true only when the developer explicitly states that a 'None' option should appear in a dropdown. IMPORTANT: NEVER create a question_choice record with text 'None' — always use this field instead.",
    ),

  read_only: z
    .boolean()
    .optional()
    .describe('Makes the variable read-only on the form.'),
  global: z
    .boolean()
    .optional()
    .describe('Makes the variable visible in sc_task.'),
  active: z.boolean().optional().describe('Whether the variable is active.'),
  display_title: z
    .boolean()
    .optional()
    .describe(
      "type=19 (Container Start) ONLY. When true, the container's title (question_text) is rendered as a visible section heading on the form. Defaults to false (title hidden). Use when you want to divide form sections with a visible label.",
    ),
  layout: z
    .enum(['normal', '2across', '2down'])
    .optional()
    .describe(
      "type=19 (Container Start) ONLY. Controls how variables inside the container are distributed. 'normal' = 1 column (default). '2across' = 2 columns, variables fill left-to-right. '2down' = 2 columns, variables fill top-to-bottom on each side. Omit to keep the default single-column layout.",
    ),
  map_to_field: z
    .boolean()
    .optional()
    .describe(
      'Record Producer ONLY. When true, the variable value is automatically mapped to a field ' +
        'on the target table record upon submission. Pair with `field`. ' +
        'Has no effect on standard catalog items. ' +
        'Does NOT work when the variable belongs to a variable set — use the Record Producer script instead.',
    ),
  field: z
    .string()
    .optional()
    .describe(
      'Record Producer ONLY. Column name on the target table to map this variable value to. ' +
        'Only set when map_to_field=true. Must be the exact field name (snake_case), e.g. "short_description", "urgency", "caller_id". ' +
        'Do NOT pass a sys_id or a display value.',
    ),
});

export const CatalogVariableCreate = CatalogVariableBase.extend({
  mandatory: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether the field is required. Defaults to false.'),
  hidden: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Hidden variables are submitted with the request but not shown on the form. Defaults to false.',
    ),
  order: z
    .number()
    .int()
    .optional()
    .default(100)
    .describe(
      'Display order on the form. Use ascending values across variables. Defaults to 100.',
    ),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the variable is active. Defaults to true.'),
  choices: z
    .array(ChoiceItem)
    .optional()
    .describe(
      "REQUIRED for type=3 (Multiple Choice) and type=5 (Select Box). Always infer choices from the developer's description.",
    ),
});

export const CatalogVariableUpdate = CatalogVariableBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the variable (item_option_new) to update.'),
  choices: z
    .array(ChoiceItemUpdate)
    .optional()
    .describe(
      'Choices to update or create. Each entry with sys_id patches that question_choice record; ' +
        'entries without sys_id create a new choice. Omit the array to leave choices untouched.',
    ),
});

// ── Catalog Client Script ─────────────────────────────────────────────────────

const CatalogClientScriptBase = z.object({
  name: z
    .string()
    .min(1)
    .describe('Unique display name for this script on the catalog item.'),
  type: z
    .enum(['onLoad', 'onChange', 'onSubmit', 'onCellEdit'])
    .describe(
      "Script type. Use 'onChange' when targeting a specific variable's change event. " +
        "Use 'onLoad' for initialization. Use 'onSubmit' for validation before submit.",
    ),
  script: z
    .string()
    .min(1)
    .describe(
      'Full JavaScript function. Must use the correct signature for the type. ' +
        "onChange scripts MUST include 'if (isLoading) return;' as the first line inside the function.",
    ),
  cat_variable: z
    .string()
    .optional()
    .describe(
      "REQUIRED for type='onChange' only. Format: IO:<variable_sys_id>",
    ),
  active: z.boolean().optional().describe('Whether the script is active.'),
  ui_type: z
    .enum(['all', 'desktop', 'mobile'])
    .optional()
    .describe(
      "'all' = classic portal + Service Portal. " +
        "'desktop' = classic portal only. 'mobile' = Service Portal / Mobile only.",
    ),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Execution order when multiple scripts of the same type exist on the item.',
    ),
});

export const CatalogClientScriptCreate = CatalogClientScriptBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the script is active. Defaults to true.'),
  ui_type: z
    .enum(['all', 'desktop', 'mobile'])
    .optional()
    .default('all')
    .describe(
      "'all' = classic portal + Service Portal (default). " +
        "'desktop' = classic portal only. 'mobile' = Service Portal / Mobile only.",
    ),
  order: z
    .number()
    .int()
    .optional()
    .default(100)
    .describe(
      'Execution order when multiple scripts of the same type exist on the item. Defaults to 100.',
    ),
});

export const CatalogClientScriptUpdate =
  CatalogClientScriptBase.partial().extend({
    sys_id: z
      .string()
      .min(1)
      .describe('sys_id of the catalog_script_client record to update.'),
  });

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

// ── UI Policy ─────────────────────────────────────────────────────────────────

const UiPolicyBase = z.object({
  short_description: z
    .string()
    .min(1)
    .describe(
      'Brief label describing the condition that triggers the policy. ' +
        "catalog_ui_policy has no 'name' field — this is the main label.",
    ),
  applies_to: z
    .enum(['item'])
    .describe("'item' to apply to a specific catalog item."),
  catalog_item: z
    .string()
    .optional()
    .describe("sys_id of the catalog item. Required when applies_to='item'."),
  catalog_conditions: z
    .string()
    .optional()
    .describe(
      'Encoded condition string. Format: IO:<variable_sys_id>=<value>^EQ. ' +
        'Use ^OR for multiple values, ^ for AND. Always end with ^EQ.',
    ),
  active: z.boolean().optional().describe('Whether the policy is active.'),
  on_load: z
    .boolean()
    .optional()
    .describe('Run the policy when the form loads, not only on field change.'),
  reverse_if_false: z
    .boolean()
    .optional()
    .describe('Reverse actions when the condition evaluates to false.'),
  run_scripts: z
    .boolean()
    .optional()
    .describe('Whether to run UI Policy scripts.'),
  applies_catalog: z
    .boolean()
    .optional()
    .describe(
      'Apply policy on the catalog request form (Service Portal / Native UI). Defaults to true.',
    ),
  applies_req_item: z
    .boolean()
    .optional()
    .describe(
      'Apply policy on the RITM form (approvers and requesters reviewing the request). Defaults to true.',
    ),
  applies_sc_task: z
    .boolean()
    .optional()
    .describe(
      'Apply policy on SC Task records (fulfiller view). Defaults to true.',
    ),
});

export const UiPolicyCreate = UiPolicyBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the policy is active. Defaults to true.'),
  on_load: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Run the policy when the form loads, not only on field change. Defaults to true.',
    ),
  reverse_if_false: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Reverse actions when the condition evaluates to false. Defaults to true.',
    ),
  run_scripts: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to run UI Policy scripts. Defaults to false.'),
  applies_catalog: z
    .boolean()
    .optional()
    .default(true)
    .describe('Apply on catalog request form. Defaults to true.'),
  applies_req_item: z
    .boolean()
    .optional()
    .default(true)
    .describe('Apply on RITM form. Defaults to true.'),
  applies_sc_task: z
    .boolean()
    .optional()
    .default(true)
    .describe('Apply on SC Task records. Defaults to true.'),
});

export const UiPolicyUpdate = UiPolicyBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the catalog_ui_policy record to update.'),
});

// ── UI Policy Action ──────────────────────────────────────────────────────────

const UiPolicyActionBase = z.object({
  ui_policy: z
    .string()
    .min(1)
    .describe('sys_id of the parent catalog_ui_policy record.'),
  catalog_item: z
    .string()
    .min(1)
    .describe('sys_id of the catalog item this action applies to.'),
  catalog_variable: z
    .string()
    .min(1)
    .describe(
      'Variable reference in format IO:<variable_sys_id>. Example: IO:abc123def456abc123def456abc123de',
    ),
  variable: z
    .string()
    .optional()
    .describe(
      "Internal name of the variable (e.g. 'request_type'). Stored in the 'variable' field on catalog_ui_policy_action.",
    ),
  visible: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe("Whether the variable should be visible. 'ignore' = no change."),
  mandatory: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe(
      "Whether the variable should be mandatory. NEVER set to 'true' together with disabled='true'.",
    ),
  disabled: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .describe(
      "Whether the variable should be read-only/disabled. NEVER set to 'true' together with mandatory='true'.",
    ),
  value_action: z
    .enum(['clear_value', 'set_value', 'ignore'])
    .optional()
    .describe(
      "What to do with the variable's value. 'clear_value' empties it, 'set_value' sets it, 'ignore' leaves it unchanged.",
    ),
  value: z
    .string()
    .optional()
    .describe(
      "The value to set on the variable. Only used when value_action='set_value'.",
    ),
  field_message_type: z
    .enum(['error', 'info', 'warning', 'none'])
    .optional()
    .describe(
      "Type of inline message to display on the variable. 'none' shows no message.",
    ),
  field_message: z
    .string()
    .optional()
    .describe(
      "Message text shown on the variable. Required when field_message_type is not 'none'.",
    ),
  cleared: z
    .boolean()
    .optional()
    .describe(
      'Cleans the variable value when the conditions of ui policy are met.',
    ),
});

export const UiPolicyActionCreate = UiPolicyActionBase.extend({
  visible: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe(
      "Whether the variable should be visible. Defaults to 'ignore' (no change).",
    ),
  mandatory: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe(
      "Whether the variable should be mandatory. Defaults to 'ignore'. NEVER set to 'true' together with disabled='true'.",
    ),
  disabled: z
    .enum(['true', 'false', 'ignore'])
    .optional()
    .default('ignore')
    .describe(
      "Whether the variable should be read-only/disabled. Defaults to 'ignore'. NEVER set to 'true' together with mandatory='true'.",
    ),
  value_action: z
    .enum(['clear_value', 'set_value', 'ignore'])
    .optional()
    .default('ignore')
    .describe(
      "What to do with the variable's value. 'clear_value' empties it, 'set_value' sets it, 'ignore' leaves it unchanged. Defaults to 'ignore'.",
    ),
  field_message_type: z
    .enum(['error', 'info', 'warning', 'none'])
    .optional()
    .default('none')
    .describe(
      "Type of inline message to display on the variable. 'none' shows no message. Defaults to 'none'.",
    ),
});

export const UiPolicyActionUpdate = UiPolicyActionBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the catalog_ui_policy_action record to update.'),
});

// ── Record Producer ───────────────────────────────────────────────────────────

const RecordProducerBase = z.object({
  name: z.string().min(1).describe('Display name of the record producer.'),
  table_name: z
    .string()
    .min(1)
    .describe(
      'Internal table name where the record will be generated, e.g. "incident". ' +
        'Call resolve_table if you need to look up the table name.',
    ),
  short_description: z
    .string()
    .optional()
    .describe('One-line summary shown in the catalog browse view.'),
  description: z
    .string()
    .optional()
    .describe('Full description of the record producer.'),
  catalog_sys_id: z
    .string()
    .optional()
    .describe(
      'sys_id of the Service Catalog this record producer belongs to. ' +
        'Call list_catalogs to look it up by name.',
    ),
  category_sys_id: z
    .string()
    .optional()
    .describe(
      'sys_id of the category (sc_category record). ' +
        'Call list_catalog_categories to look it up by name.',
    ),
  active: z
    .boolean()
    .optional()
    .describe('Whether the record producer is active.'),
  order: z
    .number()
    .int()
    .optional()
    .describe('Sort order within the category.'),
  redirect_url: z
    .enum(['generated_record', 'catalog_home'])
    .optional()
    .describe(
      '"generated_record" redirects to the created record after submission (default). ' +
        '"catalog_home" redirects to the catalog homepage.',
    ),
  script: z
    .string()
    .optional()
    .describe(
      'Server-side JavaScript executed BEFORE the record is created (pre-insert). ' +
        'Use `current` to set fields on the destination record (e.g. current.short_description = producer.var1). ' +
        'Use `producer.var1` to read form variables. ' +
        'Never call current.update() or current.insert() — the Record Producer handles that. ' +
        'Runs AFTER variable mappings, so it can override mapped values. ' +
        'If the logic is reused across producers, extract it into a Script Include. ' +
        'If omitted, the default boilerplate comment block is used.',
    ),
  post_insert_script: z
    .string()
    .optional()
    .describe(
      'Server-side JavaScript executed AFTER the record has been created (post-insert). ' +
        '`current` is the already-saved GlideRecord — call current.update() to persist further changes. ' +
        '`producer.var1` accesses form variables. `cat_item` is the Record Producer itself. ' +
        'If omitted, the default boilerplate comment block is used.',
    ),
  no_save_as_draft: z
    .boolean()
    .optional()
    .describe(
      'When true, the record producer is NOT saved as a draft (hides the Draft watermark in the catalog). ' +
        'Set to true to publish the item without the draft indicator.',
    ),
  flow_designer_flow: z
    .string()
    .optional()
    .describe(
      'sys_id of the Flow Designer flow (sys_hub_flow) to run after submission. ' +
        'Call list_flows to look it up by name. ' +
        'Mutually exclusive with workflow — set only one.',
    ),
  workflow: z
    .string()
    .optional()
    .describe(
      'sys_id of the classic Workflow (wf_workflow) to run after submission. ' +
        'Call list_workflows to look it up by name. ' +
        'Mutually exclusive with flow_designer_flow — set only one.',
    ),
  mandatory_attachment: z
    .boolean()
    .optional()
    .describe('When true, the user must attach a file before submitting.'),
  hide_sp: z
    .boolean()
    .optional()
    .describe(
      'When true, the record producer is hidden in the Service Portal.',
    ),
  no_search: z
    .boolean()
    .optional()
    .describe(
      'When true, the record producer is excluded from catalog search results.',
    ),
  availability: z
    .enum(['on_desktop', 'on_mobile', 'both', 'none'])
    .optional()
    .describe(
      'Where the record producer is available. ' +
        '"on_desktop" = classic portal only (default). ' +
        '"on_mobile" = mobile only. ' +
        '"both" = classic portal and mobile. ' +
        '"none" = hidden everywhere.',
    ),
});

export const RecordProducerCreate = RecordProducerBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the record producer is active. Defaults to true.'),
  order: z
    .number()
    .int()
    .optional()
    .default(100)
    .describe('Sort order within the category. Defaults to 100.'),
  redirect_url: z
    .enum(['generated_record', 'catalog_home'])
    .optional()
    .default('generated_record')
    .describe(
      '"generated_record" redirects to the created record after submission (default). ' +
        '"catalog_home" redirects to the catalog homepage.',
    ),
});

export const RecordProducerUpdate = RecordProducerBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe(
      'sys_id of the record producer (sc_cat_item_producer) to update.',
    ),
});

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

// ── ATF (Automated Test Framework) ──────────────────────────────────────────────

export const AtfListStepConfigs = z.object({
  name_contains: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring to filter step config names, e.g. "Record" or "Open".',
    ),
  category: z
    .string()
    .optional()
    .describe(
      'Filter by category label, e.g. "Server", "Form", "Service Catalog", "REST". ' +
        'Matches the sys_atf_step_config_category name.',
    ),
  active_only: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Only return active, non-deprecated step configs. Defaults to true.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(100)
    .describe(
      'Maximum number of step configs to return (1–200). Defaults to 100.',
    ),
});

export const AtfGetStepConfigSchema = z.object({
  step_config: z
    .string()
    .min(1)
    .describe(
      'sys_id OR exact name of the step config (sys_atf_step_config), ' +
        'e.g. "Record Insert" or its 32-char sys_id. Call list_atf_step_configs to discover names.',
    ),
});

export const AtfGetTest = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe(
      'sys_id of the test (sys_atf_test) to read with its ordered steps.',
    ),
});

export const AtfListTests = z.object({
  name_contains: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring to filter test names, e.g. "Connectivity".',
    ),
  active_only: z
    .boolean()
    .optional()
    .default(true)
    .describe('Only return active tests. Defaults to true.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of tests to return (1–100). Defaults to 20.'),
});

// ── ATF Test Suite ──

const AtfTestSuiteBase = z.object({
  name: z.string().min(1).describe('Display name of the test suite.'),
  description: z
    .string()
    .optional()
    .describe('Plain-text description of what the suite covers.'),
  active: z
    .boolean()
    .optional()
    .describe(
      'Whether the suite is active. Set false to soft-delete (there is no hard delete).',
    ),
});

export const AtfTestSuiteCreate = AtfTestSuiteBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the suite is active. Defaults to true.'),
});

export const AtfTestSuiteUpdate = AtfTestSuiteBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the test suite (sys_atf_test_suite) to update.'),
});

// ── ATF Test ──

const AtfTestBase = z.object({
  name: z.string().min(1).describe('Display name of the test.'),
  description: z
    .string()
    .optional()
    .describe('Plain-text description of what the test verifies.'),
  active: z
    .boolean()
    .optional()
    .describe(
      'Whether the test is active. Set false to soft-delete (there is no hard delete).',
    ),
  enable_parameterized_testing: z
    .boolean()
    .optional()
    .describe(
      'Enables data-driven (parameterized) testing on this test. Leave unset unless requested.',
    ),
});

export const AtfTestCreate = AtfTestBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the test is active. Defaults to true.'),
});

export const AtfTestUpdate = AtfTestBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the test (sys_atf_test) to update.'),
});

export const AtfAddTestToSuite = z.object({
  test_suite: z
    .string()
    .min(1)
    .describe('sys_id of the test suite (sys_atf_test_suite).'),
  test: z.string().min(1).describe('sys_id of the test (sys_atf_test) to add.'),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Execution order of this test within the suite. Defaults to the next multiple of 100.',
    ),
});

// ── ATF Step + inputs ──

const AtfStepInput = z.object({
  element: z
    .string()
    .min(1)
    .describe(
      'The input key (element) on the step config, e.g. "table", "field_values", "record". ' +
        'Call get_atf_step_config_schema to list the valid elements and their types.',
    ),
  value: z
    .string()
    .optional()
    .describe(
      'Literal value for this input, formatted for its internal_type: ' +
        'table_name/string/choice = plain text; reference/document_id = a 32-char sys_id; ' +
        'template_value/condition = an encoded query like "field=value^EQ". ' +
        'For catalog variable_template_value (Set Variable Values SP) it is ' +
        '"IO:<item_option_new_sysid>=<stored_value>^...^EQ", where <stored_value> is the ' +
        "variable's STORED value, NOT its label — derive it, do not guess: Yes/No vars store " +
        '"Yes"/"No" (not true/false), Select Box stores the choice value (not its text), ' +
        'reference stores a sys_id, Date/Time uses "YYYY-MM-DD HH:MM:SS". When a UI policy ' +
        "depends on the variable, read the policy's raw catalog_conditions (catalog_ui_policy) — " +
        'it already contains the exact value to match. ' +
        'To embed a previous step output inside an encoded query, include the token ' +
        "{{step['<step_sys_id>'].<output_element>}}, e.g. \"caller_id={{step['abc...'].user}}^EQ\". " +
        'Assert-type choice inputs (e.g. assert_type) left empty make the step assert ' +
        'NOTHING — always set them explicitly. ' +
        'Mutually exclusive with map_from_step.',
    ),
  map_from_step: z
    .string()
    .optional()
    .describe(
      'sys_id of an earlier sys_atf_step whose output feeds this input (whole-value mapping). ' +
        "When set, the value becomes the token {{step['<map_from_step>'].<map_output>}}. " +
        'Pair with map_output. Mutually exclusive with value.',
    ),
  map_output: z
    .string()
    .optional()
    .describe(
      'The output element on the producing step config to map from, e.g. "record_id", "table", "user". ' +
        'Call get_atf_step_config_schema on the producing step config to list outputs. Required with map_from_step.',
    ),
});

const AtfStepBase = z.object({
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Execution order of the step within the test. Defaults to the next multiple of 100 ' +
        '(appends at the end). To INSERT a step between existing ones — e.g. a pre-condition ' +
        'state validation BEFORE the step that mutates state — pass an order between the ' +
        "neighbouring steps' orders (orders are spaced by 100, so there is always room).",
    ),
  active: z
    .boolean()
    .optional()
    .describe(
      'Whether the step is active. Set false to soft-disable the step.',
    ),
  inputs: z
    .array(AtfStepInput)
    .optional()
    .describe(
      'Input values for the step. Each entry targets one element of the step config. ' +
        'Omit to create the step without configured inputs (configure later via update_atf_step).',
    ),
});

export const AtfAddStep = AtfStepBase.extend({
  test: z
    .string()
    .min(1)
    .describe('sys_id of the test (sys_atf_test) this step belongs to.'),
  step_config: z
    .string()
    .min(1)
    .describe(
      'sys_id OR exact name of the step config (sys_atf_step_config) that defines this step type, ' +
        'e.g. "Record Insert". Call list_atf_step_configs / get_atf_step_config_schema first.',
    ),
});

export const AtfUpdateStep = AtfStepBase.extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the step (sys_atf_step) to update.'),
});

// ── Scheduled Jobs (sysauto) ────────────────────────────────────────────────
//
// Shared scheduling fields live on the base `sysauto` table and are inherited
// by every job type (sysauto_script, sysauto_report, sysauto_template, …).
// Time encoding (verified against a PDI): `run_time` and `run_start` are stored
// and accepted as UTC — the Table API does NOT convert them — and `run_period`
// is a duration anchored at the 1970-01-01 epoch (computed for the caller from
// the period_* fields). Day-of-week is 1=Monday … 7=Sunday.

export const SCHEDULED_JOB_RUN_TYPES = [
  'daily',
  'weekly',
  'monthly',
  'week_in_month',
  'day_and_month_in_year',
  'day_week_month_year',
  'periodically',
  'once',
  'business_calendar_start',
  'business_calendar_end',
  'on_demand',
] as const;

const ScheduledJobBase = z.object({
  name: z
    .string()
    .min(1)
    .describe('Display name of the scheduled job. Used for idempotency.'),
  active: z.boolean().optional().describe('Whether the job is active.'),
  run_type: z
    .enum(SCHEDULED_JOB_RUN_TYPES)
    .optional()
    .describe(
      'How often the job runs, and which timing fields apply:\n' +
        '- daily: run_time\n' +
        '- weekly: run_time + run_dayofweek (one day) or run_daysofweek (several days)\n' +
        '- monthly: run_time + run_dayofmonth\n' +
        '- week_in_month: run_time + run_weekinmonth + run_dayofweek (e.g. 2nd Wednesday each month)\n' +
        '- day_and_month_in_year: run_time + run_month + run_dayofmonth (e.g. June 15 yearly)\n' +
        '- day_week_month_year: run_time + run_month + run_weekinmonth + run_dayofweek (e.g. 2nd Wednesday of June yearly)\n' +
        '- periodically: run_start + one or more period_* fields (the repeat interval)\n' +
        '- once: run_start (the single date/time it runs)\n' +
        '- business_calendar_start / business_calendar_end: business_calendar + offset_* + offset_type (fire relative to each calendar entry start/end)\n' +
        '- on_demand: never auto-runs; only via run_scheduled_job or another job.',
    ),
  run_time: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}$/, 'Expected time as "HH:MM:SS".')
    .optional()
    .describe(
      'Time of day the job fires, as "HH:MM:SS" (24-hour). Used by every ' +
        'time-of-day run_type (daily, weekly, monthly, week_in_month, ' +
        'day_and_month_in_year, day_week_month_year). Interpreted in `time_zone` ' +
        'when that is set (recommended — handles daylight saving for recurring ' +
        "jobs); otherwise in the instance's system time zone.",
    ),
  time_zone: z
    .string()
    .optional()
    .describe(
      "Time zone in which run_time is evaluated, written to the job's " +
        '"Run as tz" field — e.g. "US/Eastern", "America/New_York", "Europe/Madrid", ' +
        '"GMT". ServiceNow fires the job at run_time wall-clock in this zone and ' +
        'handles daylight saving automatically. Omit to use the instance default. ' +
        'Does not affect run_start, which is always an absolute UTC date/time.',
    ),
  run_dayofweek: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe(
      'Single day of week for run_type=weekly. 1=Monday … 7=Sunday. ' +
        'For more than one day per week use run_daysofweek instead.',
    ),
  run_daysofweek: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .optional()
    .describe(
      'Multiple days of week for run_type=weekly — the job fires on every listed ' +
        'day. 1=Monday … 7=Sunday, e.g. [2,3] = Tuesday and Wednesday. Maps to the ' +
        'sysauto "Days of Week" field and switches the trigger to "Days in Week" ' +
        'mode. Use this instead of run_dayofweek when the report must go out on ' +
        'several days each week. Takes precedence over run_dayofweek if both are set.',
    ),
  run_dayofmonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe(
      'Day of month (1–31). Used by run_type monthly and day_and_month_in_year.',
    ),
  run_weekinmonth: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe(
      'Which occurrence of the weekday within the month, for run_type ' +
        'week_in_month and day_week_month_year. 1=First … 5=Fifth, 6=Sixth.',
    ),
  run_month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      'Month of year (1=January … 12=December), for run_type ' +
        'day_and_month_in_year and day_week_month_year.',
    ),
  period_days: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('run_type=periodically: days component of the repeat interval.'),
  period_hours: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('run_type=periodically: hours component of the repeat interval.'),
  period_minutes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'run_type=periodically: minutes component of the repeat interval.',
    ),
  period_seconds: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'run_type=periodically: seconds component of the repeat interval.',
    ),
  run_start: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'Expected UTC date/time as "YYYY-MM-DD HH:MM:SS".',
    )
    .optional()
    .describe(
      'Start date/time as UTC "YYYY-MM-DD HH:MM:SS". Required for run_type=once ' +
        '(the moment it runs) and run_type=periodically (anchors the repeat). ' +
        'Stored as-is in UTC — the Table API does not convert it.',
    ),
  run_end: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'Expected UTC date/time as "YYYY-MM-DD HH:MM:SS".',
    )
    .optional()
    .describe(
      'Optional end date/time as UTC "YYYY-MM-DD HH:MM:SS". After this instant ' +
        'the recurring job stops firing. Omit for a schedule with no end. ' +
        'Stored as-is in UTC.',
    ),
  business_calendar: z
    .string()
    .optional()
    .describe(
      'sys_id of a business_calendar record. Required for run_type ' +
        'business_calendar_start / business_calendar_end — the job fires relative ' +
        "to each of that calendar's entry start/end times.",
    ),
  offset_type: z
    .enum(['future', 'past'])
    .optional()
    .describe(
      'Business-calendar run types only: whether the offset_* duration is applied ' +
        "after ('future') or before ('past') each calendar entry. Defaults to 'future'.",
    ),
  offset_days: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: days component of the offset.'),
  offset_hours: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: hours component of the offset.'),
  offset_minutes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: minutes component of the offset.'),
  offset_seconds: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: seconds component of the offset.'),
  conditional: z
    .boolean()
    .optional()
    .describe('When true, the job only runs if `condition` evaluates truthy.'),
  condition: z
    .string()
    .optional()
    .describe(
      'Server-side JavaScript condition evaluated before each run. ' +
        "Only used when conditional=true, e.g. \"gs.getProperty('my.flag') == 'true'\".",
    ),
  run_as: z
    .string()
    .optional()
    .describe(
      'sys_id of the sys_user to run the job as. Defaults to the job creator.',
    ),
});

// — Scheduled Script Execution (sysauto_script) —

const ScheduledScriptBase = ScheduledJobBase.extend({
  script: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Server-side JavaScript executed on schedule. Runs in the global scope ' +
        'with full access to GlideRecord, gs, and server-side APIs.',
    ),
});

export const ScheduledScriptCreate = ScheduledScriptBase.extend({
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript executed on schedule. Runs in the global scope ' +
        'with full access to GlideRecord, gs, and server-side APIs.',
    ),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the job is active. Defaults to true.'),
  run_type: z
    .enum(SCHEDULED_JOB_RUN_TYPES)
    .optional()
    .default('daily')
    .describe('How often the job runs. Defaults to daily.'),
});

export const ScheduledScriptUpdate = ScheduledScriptBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysauto_script record to update.'),
});

// — Scheduled Email of Report (sysauto_report) —

export const SCHEDULED_REPORT_OUTPUT_TYPES = [
  'PDF',
  'PDF-landscape',
  'PDF-autoresize',
  'XLSX',
  'Excel',
  'CSV',
  'PNG',
  'embedded_PNG',
] as const;

const ScheduledReportBase = ScheduledJobBase.extend({
  report: z
    .string()
    .optional()
    .describe(
      'sys_id of the report (sys_report) to email. Query sys_report by title to look it up.',
    ),
  report_title: z
    .string()
    .optional()
    .describe('Email subject line ("Subject" on the form).'),
  report_body: z
    .string()
    .optional()
    .describe('Introductory message body (HTML allowed).'),
  user_list: z
    .string()
    .optional()
    .describe('Recipient users as a comma-separated list of sys_user sys_ids.'),
  group_list: z
    .string()
    .optional()
    .describe(
      'Recipient groups as a comma-separated list of sys_user_group sys_ids.',
    ),
  address_list: z
    .string()
    .optional()
    .describe('Extra recipients as a comma-separated list of email addresses.'),
  output_type: z
    .enum(SCHEDULED_REPORT_OUTPUT_TYPES)
    .optional()
    .describe('Format of the attached report.'),
  include_detail: z
    .boolean()
    .optional()
    .describe('Include the underlying record detail, not just the chart.'),
  zip: z.boolean().optional().describe('Compress the attachment into a .zip.'),
  omit_if_no_records: z
    .boolean()
    .optional()
    .describe('Skip sending the email when the report has no records.'),
  page_size: z
    .enum(['A3', 'A4', 'Letter', 'Legal', 'Custom'])
    .optional()
    .describe(
      'Page size for PDF output types. Use "Custom" together with ' +
        'page_height_in_pixels and page_width_in_pixels.',
    ),
  page_height_in_pixels: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Page height in pixels. Only used when page_size="Custom".'),
  page_width_in_pixels: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Page width in pixels. Only used when page_size="Custom".'),
  include_with: z
    .string()
    .optional()
    .describe(
      'sys_id of another sysauto_report job to bundle this report into the same ' +
        'email (the "Include with" field). Omit to send as its own email.',
    ),
});

export const ScheduledReportCreate = ScheduledReportBase.extend({
  report: z
    .string()
    .min(1)
    .describe(
      'sys_id of the report (sys_report) to email. Query sys_report by title to look it up.',
    ),
  output_type: z
    .enum(SCHEDULED_REPORT_OUTPUT_TYPES)
    .optional()
    .default('PDF')
    .describe('Format of the attached report. Defaults to PDF.'),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the job is active. Defaults to true.'),
  run_type: z
    .enum(SCHEDULED_JOB_RUN_TYPES)
    .optional()
    .default('daily')
    .describe('How often the report is sent. Defaults to daily.'),
});

export const ScheduledReportUpdate = ScheduledReportBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysauto_report record to update.'),
});

// — Scheduled Entity Generation (sysauto_template) —

const ScheduledRecordGenerationBase = ScheduledJobBase.extend({
  template: z
    .string()
    .optional()
    .describe(
      'sys_id of the template (sys_template) describing the record to generate ' +
        'on schedule. The template encodes the target table and field values.',
    ),
});

export const ScheduledRecordGenerationCreate =
  ScheduledRecordGenerationBase.extend({
    template: z
      .string()
      .min(1)
      .describe(
        'sys_id of the template (sys_template) describing the record to generate. ' +
          'The template encodes the target table and field values.',
      ),
    active: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether the job is active. Defaults to true.'),
    run_type: z
      .enum(SCHEDULED_JOB_RUN_TYPES)
      .optional()
      .default('daily')
      .describe('How often the record is generated. Defaults to daily.'),
  });

export const ScheduledRecordGenerationUpdate =
  ScheduledRecordGenerationBase.partial().extend({
    sys_id: z
      .string()
      .min(1)
      .describe('sys_id of the sysauto_template record to update.'),
  });

// — Read / run —

export const ScheduledJobList = z.object({
  name_contains: z
    .string()
    .optional()
    .describe('Case-insensitive substring to filter job names.'),
  job_type: z
    .enum(['all', 'script', 'report', 'record_generation'])
    .optional()
    .default('all')
    .describe(
      "Filter by job type. 'all' returns every scheduled-job type (queries the " +
        "sysauto base table); 'script' = sysauto_script, 'report' = sysauto_report, " +
        "'record_generation' = sysauto_template.",
    ),
  active_only: z
    .boolean()
    .optional()
    .default(true)
    .describe('Only return active jobs. Defaults to true.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of jobs to return (1–100). Defaults to 20.'),
});

export const ScheduledJobGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the scheduled job (any sysauto record) to read.'),
});

export const ScheduledJobRun = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe(
      'sys_id of the scheduled job (any sysauto record) to execute immediately.',
    ),
});
