import { z } from 'zod';

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
