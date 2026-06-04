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
        'Use the servicenow-query-operators skill to look up the correct operator for each field type.',
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
