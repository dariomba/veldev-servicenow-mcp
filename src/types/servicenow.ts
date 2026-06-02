export interface SnReference {
  value: string;
  display_value: string;
}

export interface SnCurrencyField extends SnReference {
  currency_display_value: string;
}

export interface RawCatalogItem {
  sys_id: SnReference;
  name: SnReference;
  short_description: SnReference;
  description: SnReference;
  active: SnReference;
  category: SnReference;
  workflow_id?: SnReference;
  sc_ic_item_staging?: SnReference;
  order: SnReference;
  price: SnCurrencyField;
  icon?: SnReference;
  picture?: SnReference;
  no_cart: SnReference;
  no_order: SnReference;
  no_quantity: SnReference;
  no_proceed_checkout: SnReference;
  fulfillment_instructions?: SnReference;
  sys_scope: SnReference;
  sys_update_name?: SnReference;
}

export interface RawVariable {
  sys_id: SnReference;
  name: SnReference;
  label?: SnReference;
  type: SnReference;
  cat_item: SnReference;
  order: SnReference;
  mandatory: SnReference;
  active: SnReference;
  default_value: SnReference;
  help_text: SnReference;
  tooltip: SnReference;
  reference?: SnReference;
  reference_qual?: SnReference;
  reference_qual_condition?: SnReference;
  choices?: SnReference;
  max_length?: SnReference;
  read_only: SnReference;
  hidden: SnReference;
  use_reference_qualifier?: SnReference;
  show_help: SnReference;
  question_text?: SnReference;
  variable_set?: SnReference;
  lookup_table?: SnReference;
  lookup_label?: SnReference;
  list_table?: SnReference;
}

// Variable type numeric → human name mapping
// Source: sys_choice table, element=type, name=item_option_new
export const VARIABLE_TYPE_MAP: Record<string, string> = {
  '1': 'Yes / No',
  '2': 'Multi Line Text',
  '3': 'Multiple Choice',
  '4': 'Numeric Scale',
  '5': 'Select Box',
  '6': 'Single Line Text',
  '7': 'CheckBox',
  '8': 'Reference',
  '9': 'Date',
  '10': 'Date/Time',
  '11': 'Label',
  '12': 'Break',
  '14': 'Custom',
  '15': 'UI Page',
  '16': 'Wide Single Line Text',
  '17': 'Custom with Label',
  '18': 'Lookup Select Box',
  '19': 'Container Start',
  '20': 'Container End',
  '21': 'List Collector',
  '22': 'Lookup Multiple Choice',
  '23': 'HTML',
  '24': 'Container Split',
  '25': 'Masked',
  '26': 'Email',
  '27': 'URL',
  '28': 'IP Address',
  '29': 'Duration',
  '31': 'Requested For',
  '32': 'Rich Text Label',
  '33': 'Attachment',
};

export interface RawUiPolicy {
  sys_id: SnReference;
  name?: SnReference;
  short_description?: SnReference;
  catalog_item: SnReference;
  catalog_conditions?: SnReference;
  run_scripts: SnReference;
  on_load: SnReference;
  reverse_if_false: SnReference;
  active: SnReference;
  order: SnReference;
  applies_to?: SnReference;
}

export interface RawUiPolicyAction {
  sys_id: SnReference;
  ui_policy: SnReference;
  catalog_variable?: SnReference;
  variable_name?: SnReference;
  visible: SnReference;
  mandatory: SnReference;
  disabled: SnReference;
  value_action?: SnReference;
  value?: SnReference;
  field_message_type?: SnReference;
  field_message?: SnReference;
}

export interface RawClientScript {
  sys_id: SnReference;
  name: SnReference;
  cat_item: SnReference;
  script: SnReference;
  type: SnReference;
  variable_name?: SnReference;
  active: SnReference;
  applies_to?: SnReference;
  ui_type?: SnReference;
  isolated?: SnReference;
}

export interface RawChoice {
  sys_id: SnReference;
  text: SnReference;
  value: SnReference;
  order: SnReference;
  question: SnReference;
}

export interface RawUserCriteria {
  sys_id: SnReference;
  sc_cat_item: SnReference;
  user_criteria: SnReference;
}

export interface RawUserCriteriaRecord {
  sys_id: SnReference;
  name: SnReference;
  short_description?: SnReference;
  active: SnReference;
  role?: SnReference;
  group?: SnReference;
  department?: SnReference;
  location?: SnReference;
  company?: SnReference;
  user?: SnReference;
  advanced?: SnReference;
  script?: SnReference;
}

export interface RawUserPreference {
  value: SnReference;
}

export interface RawUpdateSet {
  name: SnReference;
  application: SnReference;
}

// ---------------DOMAIN TYPES-------------------------------
export interface VariableChoice {
  sys_id: string;
  text: string;
  value: string;
  order: number;
}

export interface CatalogVariable {
  sys_id: string;
  name: string;
  label: string;
  type_code: string;
  type_label: string;
  order: number;
  mandatory: boolean;
  active: boolean;
  hidden: boolean;
  read_only: boolean;
  default_value: string;
  help_text: string;
  reference_table?: string;
  reference_qualifier?: string;
  reference_qual_condition?: string;
  use_reference_qualifier?: string;
  lookup_table?: string;
  list_table?: string;
  variable_set?: string; // display_value
  choices?: VariableChoice[]; // only populated for type 3 (Multiple Choice) and type 5 (Select Box)
}

export interface UiPolicyAction {
  sys_id: string;
  catalog_variable: string; // IO:<var_sys_id>
  variable_name: string;
  visible: string;
  mandatory: string;
  disabled: string;
  value_action?: string;
  value?: string;
  field_message_type?: string;
  field_message?: string;
}

export interface CatalogUiPolicy {
  sys_id: string;
  name: string;
  conditions: string;
  on_load: boolean;
  reverse_if_false: boolean;
  active: boolean;
  order: number;
  actions: UiPolicyAction[];
}

export interface CatalogClientScript {
  sys_id: string;
  name: string;
  type: string;
  variable_name?: string;
  active: boolean;
  script: string;
}

export interface CatalogItemDefinition {
  sys_id: string;
  name: string;
  short_description: string;
  description: string;
  active: boolean;
  order: number;
  price: string;

  category: string; // display_value
  scope: string; // scoped app display_value

  fulfillment_flow?: string; // workflow display_value if set

  variables: CatalogVariable[];
  variable_sets: { sys_id: string; name: string; order: number }[];
  ui_policies: CatalogUiPolicy[];
  client_scripts: CatalogClientScript[];
  user_criteria: string[]; // array of criteria display_values

  // Meta
  _raw_sys_id: string; // always the sys_id, for chaining
}
