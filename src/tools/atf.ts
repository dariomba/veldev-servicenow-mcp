import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from '../clients/servicenow.js';
import type { SnReference } from '../types/servicenow.js';
import {
  handleError,
  isSysId,
  resolveDisplay,
  resolveValue,
} from './helpers.js';
import {
  AtfAddStep,
  AtfAddTestToSuite,
  AtfGetStepConfigSchema,
  AtfGetTest,
  AtfListStepConfigs,
  AtfListTests,
  AtfTestCreate,
  AtfTestSuiteCreate,
  AtfTestSuiteUpdate,
  AtfTestUpdate,
  AtfUpdateStep,
} from './schemas.js';

const STEP_CONFIG_TABLE = 'sys_atf_step_config';
const TEST_TABLE = 'sys_atf_test';
const SUITE_TABLE = 'sys_atf_test_suite';
const SUITE_TEST_TABLE = 'sys_atf_test_suite_test';
const STEP_TABLE = 'sys_atf_step';
const INPUT_VAR_TABLE = 'atf_input_variable';
const OUTPUT_VAR_TABLE = 'atf_output_variable';
const VAR_VALUE_TABLE = 'sys_variable_value';
const CHOICE_TABLE = 'sys_choice';

/**
 * A step-to-step dependency is stored as the sys_id token form
 * `{{step['<producer sys_id>'].<output element>}}` in sys_variable_value, for
 * every consuming field type. (The human-readable data-pill text
 * `{{Step <n>: <config>.<label>}}` is display-only and must NOT be stored.)
 *
 * That token alone is enough for tokens embedded inside encoded queries
 * (Conditions / Field values). But for a WHOLE-VALUE map into an
 * element_mapping_provider field — e.g. the "Record" (document_id) field of
 * "Open an Existing Record" — the token in sys_variable_value is never resolved
 * at runtime on its own (the step fails with "Table ... does not have a record
 * with id '{{step[...]}}'"). Those fields also need a companion row in
 * sys_element_mapping (table = the `var__m_atf_input_variable_<configSysId>`
 * pool column, field = element, id = step sys_id, value = the token). The UI's
 * data-pill picker writes both; so does buildInputUpsertScript.
 */

type SnRecord = Record<string, SnReference | undefined>;

const val = (r: SnRecord, f: string): string =>
  r[f] ? resolveValue(r[f] as SnReference) : '';
const disp = (r: SnRecord, f: string): string =>
  r[f] ? resolveDisplay(r[f] as SnReference) : '';

interface AtfInputDef {
  sysId: string;
  element: string;
  label: string;
  internalType: string;
  mandatory: boolean;
  order: number;
  reference: string;
  /**
   * True when the input's dictionary `attributes` declare an
   * `element_mapping_provider` (e.g. the "Record" field of "Open an Existing
   * Record"). Such fields resolve a step-output mapping ONLY via a companion
   * sys_element_mapping row — a raw sys_variable_value token is never resolved
   * at runtime. See buildInputUpsertScript.
   */
  hasElementMapping: boolean;
  /** True for internal_type === 'choice'. */
  isChoice: boolean;
  /**
   * The valid choice values, resolved from sys_choice (the per-config pool
   * column var__m_atf_input_variable_<configSysId>). Empty when the input is
   * not a choice, or when its options are generated dynamically (see
   * dynamicChoices) and so can't be enumerated from a table.
   */
  choices: { value: string; label: string }[];
  /**
   * True when the choice list is produced at runtime by a script
   * (attributes `choice_script=...`) or sourced from a reference table
   * (choice_table) — its options can't be enumerated up front, so a literal
   * value for it is NOT validated. defaultValue carries the configured fallback.
   */
  dynamicChoices: boolean;
  defaultValue: string;
}

interface AtfOutputDef {
  element: string;
  label: string;
  internalType: string;
}

function recordUrl(
  client: ServiceNowClient,
  table: string,
  sysId: string,
): string {
  return `${client.getInstanceUrl()}/${table}.do?sys_id=${sysId}`;
}

async function resolveStepConfig(
  client: ServiceNowClient,
  idOrName: string,
): Promise<{ sysId: string; name: string }> {
  if (isSysId(idOrName)) {
    const rec = await client.getRecord<SnRecord>(STEP_CONFIG_TABLE, idOrName, [
      'sys_id',
      'name',
    ]);
    return { sysId: val(rec, 'sys_id'), name: disp(rec, 'name') };
  }
  const matches = await client.listRecords<SnRecord>(
    STEP_CONFIG_TABLE,
    `name=${idOrName}`,
    ['sys_id', 'name'],
    5,
  );
  if (matches.length === 0) {
    throw new Error(
      `No step config found named "${idOrName}". Call list_atf_step_configs to discover valid names.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple step configs named "${idOrName}". Pass the sys_id instead.`,
    );
  }
  return { sysId: val(matches[0], 'sys_id'), name: disp(matches[0], 'name') };
}

/**
 * The enumerable choice options for a step config's `choice` inputs, keyed by
 * element. ATF stores them in sys_choice under the config's pool column
 * `var__m_atf_input_variable_<configSysId>` (the same column buildInputUpsertScript
 * uses for sys_element_mapping), and duplicates each row per language — we dedupe
 * by value, keeping the first (English-first via the language sort). Inputs whose
 * options are script- or table-generated have no rows here; see
 * AtfInputDef.dynamicChoices.
 */
async function fetchChoices(
  client: ServiceNowClient,
  stepConfigSysId: string,
): Promise<Map<string, { value: string; label: string }[]>> {
  const recs = await client.listRecords<SnRecord>(
    CHOICE_TABLE,
    `name=var__m_atf_input_variable_${stepConfigSysId}^inactive=false^ORDERBYelement^ORDERBYsequence^ORDERBYlanguage`,
    ['element', 'value', 'label'],
    500,
  );
  const byElement = new Map<string, { value: string; label: string }[]>();
  for (const r of recs) {
    const element = val(r, 'element');
    const value = val(r, 'value');
    const list = byElement.get(element) ?? [];
    if (!list.some((c) => c.value === value)) {
      list.push({ value, label: disp(r, 'label') || value });
    }
    byElement.set(element, list);
  }
  return byElement;
}

async function fetchInputDefs(
  client: ServiceNowClient,
  stepConfigSysId: string,
): Promise<AtfInputDef[]> {
  const [recs, choices] = await Promise.all([
    client.listRecords<SnRecord>(
      INPUT_VAR_TABLE,
      `model=${stepConfigSysId}^active=true^ORDERBYorder`,
      [
        'sys_id',
        'element',
        'label',
        'internal_type',
        'mandatory',
        'order',
        'reference',
        'attributes',
        'choice_table',
        'default_value',
      ],
      100,
    ),
    fetchChoices(client, stepConfigSysId),
  ]);
  return recs.map((r) => {
    const internalType = val(r, 'internal_type');
    const attributes = val(r, 'attributes');
    return {
      sysId: val(r, 'sys_id'),
      element: val(r, 'element'),
      label: disp(r, 'label') || val(r, 'element'),
      internalType,
      mandatory: val(r, 'mandatory') === 'true',
      order: parseInt(val(r, 'order') || '100', 10) || 100,
      reference: disp(r, 'reference'),
      hasElementMapping: attributes.includes('element_mapping_provider'),
      isChoice: internalType === 'choice',
      choices: choices.get(val(r, 'element')) ?? [],
      dynamicChoices:
        attributes.includes('choice_script') || val(r, 'choice_table') !== '',
      defaultValue: val(r, 'default_value'),
    };
  });
}

async function fetchOutputDefs(
  client: ServiceNowClient,
  stepConfigSysId: string,
): Promise<AtfOutputDef[]> {
  const recs = await client.listRecords<SnRecord>(
    OUTPUT_VAR_TABLE,
    `model=${stepConfigSysId}^active=true^ORDERBYorder`,
    ['element', 'label', 'internal_type'],
    100,
  );
  return recs.map((r) => ({
    element: val(r, 'element'),
    label: disp(r, 'label') || val(r, 'element'),
    internalType: val(r, 'internal_type'),
  }));
}

/**
 * The valid output elements of an earlier step, used to validate a later step's
 * `map_output` before wiring the dependency token. configName is only for the
 * error message.
 */
interface ProducerInfo {
  configName: string;
  outputElements: Set<string>;
}

async function fetchProducerInfo(
  client: ServiceNowClient,
  stepSysId: string,
): Promise<ProducerInfo> {
  const step = await client.getRecord<SnRecord>(STEP_TABLE, stepSysId, [
    'step_config',
  ]);
  const outputs = await fetchOutputDefs(client, val(step, 'step_config'));
  return {
    configName: disp(step, 'step_config'),
    outputElements: new Set(outputs.map((o) => o.element)),
  };
}

/** Pre-loads producer metadata for every distinct mapped step in `inputs`. */
async function fetchProducers(
  client: ServiceNowClient,
  inputs: InputSpec[] | undefined,
): Promise<Map<string, ProducerInfo>> {
  const ids = [
    ...new Set(
      (inputs ?? [])
        .map((i) => i.map_from_step)
        .filter((id): id is string => !!id && isSysId(id)),
    ),
  ];
  const entries = await Promise.all(
    ids.map(async (id) => [id, await fetchProducerInfo(client, id)] as const),
  );
  return new Map(entries);
}

async function nextOrder(
  client: ServiceNowClient,
  table: string,
  query: string,
): Promise<number> {
  const recs = await client.listRecords<SnRecord>(
    table,
    `${query}^ORDERBYDESCorder`,
    ['order'],
    1,
  );
  if (recs.length === 0) return 100;
  const max = parseInt(val(recs[0], 'order') || '0', 10);
  return (Number.isNaN(max) ? 0 : max) + 100;
}

type InputSpec = {
  element: string;
  value?: string;
  map_from_step?: string;
  map_output?: string;
};

interface ResolvedInput {
  element: string;
  variableSysId: string;
  value: string;
  order: number;
  /**
   * True when this is a whole-value step-output mapping into an
   * element_mapping_provider field — requires a companion sys_element_mapping
   * row so the token resolves at runtime.
   */
  needsElementMapping: boolean;
}

/**
 * Validates each input against the step config's definitions and resolves its
 * stored value (literal, or a step-output dependency token). Pure — no I/O — so
 * callers can surface validation errors synchronously; producer metadata for a
 * mapping must be pre-loaded into `producers` (keyed by step sys_id) via
 * fetchProducers, which is also used to validate the mapped output element.
 *
 * A step dependency is always stored as the sys_id token form
 * `{{step['<producer sys_id>'].<output element>}}` — see the note above
 * fetchProducerInfo.
 */
function resolveStepInputs(
  defs: AtfInputDef[],
  inputs: InputSpec[],
  producers: Map<string, ProducerInfo>,
): ResolvedInput[] {
  const byElement = new Map(defs.map((d) => [d.element, d]));
  const validElements = defs.map((d) => d.element).join(', ') || '(none)';

  return inputs.map((input) => {
    const def = byElement.get(input.element);
    if (!def) {
      throw new Error(
        `Unknown input element "${input.element}" for this step config. Valid elements: ${validElements}.`,
      );
    }

    const isMap =
      input.map_from_step !== undefined || input.map_output !== undefined;
    let value: string;
    if (isMap) {
      if (input.value !== undefined) {
        throw new Error(
          `Input "${input.element}": provide either value or map_from_step+map_output, not both.`,
        );
      }
      if (!input.map_from_step || !input.map_output) {
        throw new Error(
          `Input "${input.element}": map_from_step and map_output must both be set.`,
        );
      }
      if (!isSysId(input.map_from_step)) {
        throw new Error(
          `Input "${input.element}": map_from_step must be the 32-char sys_id of an earlier step.`,
        );
      }
      const producer = producers.get(input.map_from_step);
      if (!producer) {
        throw new Error(
          `Input "${input.element}": could not load producer step ${input.map_from_step}.`,
        );
      }
      if (!producer.outputElements.has(input.map_output)) {
        const valid = [...producer.outputElements].join(', ') || '(none)';
        throw new Error(
          `Input "${input.element}": "${input.map_output}" is not an output of step ${input.map_from_step} (${producer.configName}). Valid outputs: ${valid}.`,
        );
      }
      // The sys_id token form is what the UI's dot-walking picker stores in
      // sys_variable_value. For element_mapping_provider fields it is also
      // mirrored into a sys_element_mapping row (see buildInputUpsertScript),
      // which is what actually makes it resolve at runtime.
      value = `{{step['${input.map_from_step}'].${input.map_output}}}`;
    } else {
      if (input.value === undefined) {
        throw new Error(
          `Input "${input.element}": provide a value, or map_from_step + map_output.`,
        );
      }
      value = input.value;
      if (
        (def.internalType === 'reference' ||
          def.internalType === 'document_id') &&
        value !== '' &&
        !value.includes('{{') &&
        !isSysId(value)
      ) {
        throw new Error(
          `Input "${input.element}" is a ${def.internalType} and expects a 32-char sys_id (or a {{step[...]}} mapping token), got "${value}".`,
        );
      }
      if (
        def.isChoice &&
        def.choices.length > 0 &&
        value !== '' &&
        !value.includes('{{') &&
        !def.choices.some((c) => c.value === value)
      ) {
        const valid = def.choices.map((c) => c.value).join(', ');
        throw new Error(
          `Input "${input.element}" is a choice and "${value}" is not one of its values. Valid: ${valid}.`,
        );
      }
    }

    return {
      element: input.element,
      variableSysId: def.sysId,
      value,
      order: def.order,
      needsElementMapping: isMap && def.hasElementMapping,
    };
  });
}

/**
 * Builds a global background script that upserts each input value into
 * sys_variable_value. Step input values CANNOT be written over the Table API —
 * that table's ACLs reject REST insert/update with HTTP 403 — so they must be
 * written server-side, where GlideRecord bypasses those ACLs. Inserting the
 * step already auto-creates the (empty) value rows, so we find-or-update by
 * (document_key, variable) to avoid duplicates.
 */
function buildInputUpsertScript(
  stepSysId: string,
  resolved: ResolvedInput[],
  stepConfigSysId: string,
): string {
  const lines = resolved.map(
    (r) =>
      `  setVal(${JSON.stringify(stepSysId)}, ${JSON.stringify(r.variableSysId)}, ${JSON.stringify(r.value)}, ${JSON.stringify(String(r.order))});`,
  );
  // The pool column that backs this step config's inputs — the `table` of a
  // sys_element_mapping row. Equals the atf_input_variable `name` shared by all
  // inputs of the config.
  const mappingTable = `var__m_atf_input_variable_${stepConfigSysId}`;
  // Whole-value step-output maps into element_mapping_provider fields (e.g. the
  // "Record" document_id of "Open an Existing Record") resolve at runtime ONLY
  // via a sys_element_mapping row — the sys_variable_value token alone is passed
  // through literally and the step fails with "Table ... does not have a record
  // with id '{{step[...]}}'". This is what the UI's data-pill picker writes.
  const mappingLines = resolved
    .filter((r) => r.needsElementMapping)
    .map(
      (r) =>
        `  setMapping(${JSON.stringify(stepSysId)}, ${JSON.stringify(r.element)}, ${JSON.stringify(r.value)});`,
    );
  // The sys_element_mapping helper + table const are only emitted when at least
  // one input actually needs a mapping row, keeping the script minimal.
  const mappingHelper = mappingLines.length
    ? [
        `  var MAPPING_TABLE = ${JSON.stringify(mappingTable)};`,
        '  function setMapping(stepId, field, value) {',
        "    var gr = new GlideRecord('sys_element_mapping');",
        "    gr.addQuery('table', MAPPING_TABLE);",
        "    gr.addQuery('field', field);",
        "    gr.addQuery('id', stepId);",
        '    gr.query();',
        '    if (gr.next()) {',
        "      gr.setValue('value', value);",
        '      gr.update();',
        '    } else {',
        '      gr.initialize();',
        "      gr.setValue('table', MAPPING_TABLE);",
        "      gr.setValue('field', field);",
        "      gr.setValue('id', stepId);",
        "      gr.setValue('value', value);",
        '      gr.insert();',
        '    }',
        '  }',
      ]
    : [];
  return [
    '(function () {',
    '  function setVal(stepId, varId, value, order) {',
    "    var gr = new GlideRecord('sys_variable_value');",
    "    gr.addQuery('document', 'sys_atf_step');",
    "    gr.addQuery('document_key', stepId);",
    "    gr.addQuery('variable', varId);",
    '    gr.query();',
    '    if (gr.next()) {',
    "      gr.setValue('value', value);",
    '      gr.update();',
    '    } else {',
    '      gr.initialize();',
    "      gr.setValue('document', 'sys_atf_step');",
    "      gr.setValue('document_key', stepId);",
    "      gr.setValue('variable', varId);",
    "      gr.setValue('value', value);",
    "      gr.setValue('order', order);",
    '      gr.insert();',
    '    }',
    '  }',
    ...mappingHelper,
    ...lines,
    ...mappingLines,
    // Re-save the step so its before-BRs ("Generate Description", display-name,
    // dependent-field processing) re-run now that the inputs exist. The step
    // was inserted with no inputs, so those BRs first ran against an empty step
    // (yielding e.g. "Open a new 'undefined' form"). A plain update() here is a
    // no-op — no field is dirty, so the BRs never re-fire. Blanking description
    // forces the record dirty; "Generate Description" then recomputes it from
    // the now-written variable values, matching a manual UI save.
    `  var stepGr = new GlideRecord('sys_atf_step');`,
    `  if (stepGr.get(${JSON.stringify(stepSysId)})) {`,
    `    var priorDescription = stepGr.getValue('description');`,
    `    stepGr.setValue('description', '');`,
    `    stepGr.update();`,
    `    // If no "Generate Description" before-BR repopulated it (e.g. the BR is`,
    `    // inactive on this instance), restore the prior text rather than leaving`,
    `    // the step permanently blank.`,
    `    var checkGr = new GlideRecord('sys_atf_step');`,
    `    if (checkGr.get(${JSON.stringify(stepSysId)}) && !checkGr.getValue('description') && priorDescription) {`,
    `      checkGr.setValue('description', priorDescription);`,
    `      checkGr.update();`,
    `    }`,
    `  }`,
    '})();',
  ].join('\n');
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The input upsert runs in a +1s sys_trigger (sys_variable_value rejects REST
 * writes — see buildInputUpsertScript), so executeBackgroundScriptTrigger is
 * fire-and-forget: it returns before the values exist. Read the rows back so the
 * tool reports what actually landed instead of optimistically claiming success.
 * Reads ARE allowed on sys_variable_value — only writes hit the 403 ACL.
 *
 * The step insert auto-creates the value rows empty, so a row merely existing is
 * not proof — we compare the stored value. We check once immediately (the writes
 * may already be visible) and only sleep-and-retry on a miss, capping the total
 * wait at a few seconds. Returns the elements still not matching their intended
 * value (empty array = everything confirmed) plus every stored value keyed by
 * variable sys_id, so callers can inspect the step's final state (e.g. flag
 * assert inputs that remain empty) without re-querying.
 */
async function verifyInputsWritten(
  client: ServiceNowClient,
  stepSysId: string,
  resolved: ResolvedInput[],
): Promise<{ pending: string[]; stored: Map<string, string> }> {
  const retryDelaysMs = [700, 900, 1100, 1300];
  let pending = resolved;
  let stored = new Map<string, string>();
  for (let attempt = 0; ; attempt++) {
    const rows = await client.listRecords<SnRecord>(
      VAR_VALUE_TABLE,
      `document=${STEP_TABLE}^document_key=${stepSysId}`,
      ['variable', 'value'],
      200,
    );
    stored = new Map(rows.map((r) => [val(r, 'variable'), val(r, 'value')]));
    pending = pending.filter((r) => stored.get(r.variableSysId) !== r.value);
    if (pending.length === 0 || attempt >= retryDelaysMs.length) break;
    await sleep(retryDelaysMs[attempt]);
  }
  return { pending: pending.map((r) => r.element), stored };
}

/**
 * ATF assert-type choice inputs (assert_type on "Submit a Form (SP)", "Record
 * Insert", …) are optional in the dictionary, yet a step whose assert is empty
 * asserts NOTHING and can pass vacuously — the #1 source of false-green ATF
 * tests. Flags every assert-like choice input whose stored value is empty.
 */
function buildAssertWarnings(
  defs: AtfInputDef[],
  stored: Map<string, string>,
): string[] {
  return defs
    .filter((d) => d.isChoice && d.element.includes('assert'))
    .filter((d) => !stored.get(d.sysId))
    .map((d) => {
      const choices = d.choices.length
        ? ` Valid values: ${d.choices.map((c) => c.value).join(', ')}.`
        : '';
      return `⚠ Assert input "${d.element}" is empty — the step asserts nothing and can pass even when the behavior under test fails. Set it explicitly.${choices}`;
    });
}

/** Renders the verifyInputsWritten outcome as a status line for both write tools. */
function formatInputStatus(
  pending: string[],
  resolved: ResolvedInput[],
): string {
  const applied = resolved
    .map((r) => r.element)
    .filter((e) => !pending.includes(e));
  if (pending.length === 0) {
    return `Inputs:      ${applied.join(', ')} — applied and confirmed.`;
  }
  return [
    `Inputs:      ${applied.length ? `${applied.join(', ')} confirmed; ` : ''}NOT confirmed: ${pending.join(', ')}.`,
    '             The server-side write may still be settling or was rejected —',
    '             re-read with get_atf_test, or retry update_atf_step.',
  ].join('\n');
}

export function registerAtfTools(
  server: McpServer,
  client: ServiceNowClient,
): void {
  // ── Read: list step configs ──────────────────────────────────────────────
  server.registerTool(
    'list_atf_step_configs',
    {
      title: 'List ATF Step Configs',
      description: [
        'Lists ServiceNow ATF step config types (sys_atf_step_config) — the building',
        'blocks available when adding steps to a test (e.g. "Record Insert",',
        '"Open a New Form", "Run Server Side Script").',
        '',
        'Filter by category (Server, Form, REST, Service Catalog, …) or by a name',
        'substring. Returns name, sys_id, category and batch-order constraint.',
        '',
        "Call get_atf_step_config_schema next to see a config's inputs and outputs.",
      ].join('\n'),
      inputSchema: AtfListStepConfigs.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, category, active_only, limit }) => {
      try {
        const clauses: string[] = [];
        if (active_only) clauses.push('active=true', 'deprecated=false');
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        if (category) clauses.push(`category.name=${category}`);
        clauses.push('ORDERBYname');
        const recs = await client.listRecords<SnRecord>(
          STEP_CONFIG_TABLE,
          clauses.join('^'),
          ['sys_id', 'name', 'category', 'step_env', 'batch_order_constraint'],
          limit,
        );

        const rows = recs.map((r) => ({
          name: disp(r, 'name'),
          sys_id: val(r, 'sys_id'),
          category: disp(r, 'category'),
          environment: disp(r, 'step_env'),
          batch_order_constraint: disp(r, 'batch_order_constraint'),
        }));

        const summary = [
          `${rows.length} step config(s)${category ? ` in category "${category}"` : ''}${name_contains ? ` matching "${name_contains}"` : ''}:`,
          '',
          ...rows.map(
            (r) =>
              `• ${r.name}${r.category ? ` [${r.category}]` : ''} — ${r.sys_id}`,
          ),
        ].join('\n');

        return {
          content: [
            { type: 'text' as const, text: summary },
            { type: 'text' as const, text: JSON.stringify(rows, null, 2) },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Read: step config schema (inputs + outputs) ───────────────────────────
  server.registerTool(
    'get_atf_step_config_schema',
    {
      title: 'Get ATF Step Config Schema',
      description: [
        'Returns the input and output variables of an ATF step config.',
        '',
        'INPUTS are the elements you set when adding a step (add_atf_step). Each lists',
        'its element key, label, internal_type (table_name, reference, document_id,',
        'template_value/condition, choice, string, …) and whether it is mandatory.',
        '',
        'OUTPUTS are the values this step produces. Use an output element as map_output',
        'in a later step to wire a dependency (e.g. "record_id" from a Record Insert).',
        '',
        'Pass the step config sys_id OR its exact name.',
      ].join('\n'),
      inputSchema: AtfGetStepConfigSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ step_config }) => {
      try {
        const { sysId, name } = await resolveStepConfig(client, step_config);
        const [inputs, outputs] = await Promise.all([
          fetchInputDefs(client, sysId),
          fetchOutputDefs(client, sysId),
        ]);

        const summary = [
          `Step config: ${name} (${sysId})`,
          '',
          `Inputs (${inputs.length}):`,
          ...inputs.map((i) => {
            let choices = '';
            if (i.isChoice && i.choices.length > 0) {
              choices = ` — choices: ${i.choices.map((c) => c.value).join(', ')}`;
            } else if (i.isChoice && i.dynamicChoices) {
              const def =
                i.defaultValue && !i.defaultValue.startsWith('javascript:')
                  ? ` (default: ${i.defaultValue})`
                  : '';
              choices = ` — choices: dynamic, verify in UI${def}`;
            }
            return `  • ${i.element} — ${i.label} [${i.internalType}]${i.mandatory ? ' (mandatory)' : ''}${i.reference ? ` → ${i.reference}` : ''}${choices}`;
          }),
          '',
          `Outputs (${outputs.length}) — usable as map_output in later steps:`,
          ...outputs.map(
            (o) => `  • ${o.element} — ${o.label} [${o.internalType}]`,
          ),
        ].join('\n');

        return {
          content: [
            { type: 'text' as const, text: summary },
            {
              type: 'text' as const,
              text: JSON.stringify(
                { sys_id: sysId, name, inputs, outputs },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Read: list/search tests ───────────────────────────────────────────────
  server.registerTool(
    'list_atf_tests',
    {
      title: 'List ATF Tests',
      description: [
        'Lists/searches ATF tests (sys_atf_test), most recently updated first.',
        "Use it to discover a test's sys_id, then read its steps with get_atf_test.",
      ].join('\n'),
      inputSchema: AtfListTests.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, active_only, limit }) => {
      try {
        const clauses: string[] = [];
        if (active_only) clauses.push('active=true');
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        clauses.push('ORDERBYDESCsys_updated_on');
        const recs = await client.listRecords<SnRecord>(
          TEST_TABLE,
          clauses.join('^'),
          ['sys_id', 'name', 'description', 'active', 'sys_updated_on'],
          limit,
        );

        const rows = recs.map((r) => ({
          sys_id: val(r, 'sys_id'),
          name: disp(r, 'name'),
          description: disp(r, 'description'),
          active: val(r, 'active') === 'true',
          updated: disp(r, 'sys_updated_on'),
          url: recordUrl(client, TEST_TABLE, val(r, 'sys_id')),
        }));

        const summary = [
          `${rows.length} test(s)${name_contains ? ` matching "${name_contains}"` : ''}:`,
          '',
          ...rows.map(
            (r) =>
              `• ${r.name}${r.active ? '' : ' (inactive)'} — ${r.sys_id} (updated ${r.updated})`,
          ),
        ].join('\n');

        return {
          content: [
            { type: 'text' as const, text: summary },
            { type: 'text' as const, text: JSON.stringify(rows, null, 2) },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Read: full test with steps ────────────────────────────────────────────
  server.registerTool(
    'get_atf_test',
    {
      title: 'Get ATF Test',
      description: [
        "Reads an ATF test (sys_atf_test) with its ordered steps and each step's",
        'configured input values. Includes the test URL to open and run it in the UI.',
      ].join('\n'),
      inputSchema: AtfGetTest.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const test = await client.getRecord<SnRecord>(TEST_TABLE, sys_id);
        const steps = await client.listRecords<SnRecord>(
          STEP_TABLE,
          `test=${sys_id}^ORDERBYorder`,
          ['sys_id', 'order', 'step_config', 'active', 'description', 'table'],
          200,
        );

        const stepValues = await Promise.all(
          steps.map((s) =>
            client.listRecords<SnRecord>(
              VAR_VALUE_TABLE,
              `document=${STEP_TABLE}^document_key=${val(s, 'sys_id')}^ORDERBYorder`,
              // variable.element is the input's element key — what add_atf_step /
              // update_atf_step take — vs. the variable's display label.
              ['variable', 'variable.element', 'value', 'order'],
              100,
            ),
          ),
        );

        const stepObjs = steps.map((s, idx) => ({
          sys_id: val(s, 'sys_id'),
          order: val(s, 'order'),
          step_config: disp(s, 'step_config'),
          active: val(s, 'active') === 'true',
          table: disp(s, 'table'),
          inputs: stepValues[idx].map((v) => ({
            element: val(v, 'variable.element'),
            variable: disp(v, 'variable'),
            value: disp(v, 'value'),
          })),
        }));

        const result = {
          sys_id: val(test, 'sys_id'),
          name: disp(test, 'name'),
          description: disp(test, 'description'),
          active: val(test, 'active') === 'true',
          url: recordUrl(client, TEST_TABLE, sys_id),
          steps: stepObjs,
        };

        const summary = [
          `Test: ${result.name} (${result.sys_id})`,
          `Active: ${result.active}`,
          `URL:   ${result.url}`,
          '',
          `Steps (${stepObjs.length}):`,
          ...stepObjs.flatMap((s) => [
            `  ${s.order}. ${s.step_config}${s.active ? '' : ' (inactive)'} — ${s.sys_id}`,
            ...s.inputs.map(
              (i) =>
                `       ${i.variable}${i.element ? ` [${i.element}]` : ''}: ${i.value}`,
            ),
          ]),
        ].join('\n');

        return {
          content: [
            { type: 'text' as const, text: summary },
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: create test suite ──────────────────────────────────────────────
  server.registerTool(
    'create_atf_test_suite',
    {
      title: 'Create ATF Test Suite',
      description: [
        'Creates an ATF test suite (sys_atf_test_suite). A suite groups tests so they',
        'run together in order. Add tests with add_atf_test_to_suite.',
        '',
        'Returns the suite sys_id and URL.',
      ].join('\n'),
      inputSchema: AtfTestSuiteCreate.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, description, active }) => {
      try {
        const body: Record<string, unknown> = { name, active: String(active) };
        if (description !== undefined) body.description = description;
        const created = await client.createRecord<SnRecord>(SUITE_TABLE, body);
        const sysId = val(created, 'sys_id');
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Test suite created successfully.',
                '',
                `Name:   ${name}`,
                `sys_id: ${sysId}`,
                `URL:    ${recordUrl(client, SUITE_TABLE, sysId)}`,
                '',
                'Add tests to it with add_atf_test_to_suite.',
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: update test suite (incl. soft-delete via active=false) ──────────
  server.registerTool(
    'update_atf_test_suite',
    {
      title: 'Update ATF Test Suite',
      description: [
        'Updates an ATF test suite (sys_atf_test_suite). Pass only fields to change.',
        'Set active=false to soft-delete the suite — there is no hard delete.',
      ].join('\n'),
      inputSchema: AtfTestSuiteUpdate.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, name, description, active }) => {
      try {
        if (!isSysId(sys_id)) {
          return errText(`"${sys_id}" is not a valid test suite sys_id.`);
        }
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (active !== undefined) body.active = String(active);
        await client.patchRecord(SUITE_TABLE, sys_id, body);
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Test suite updated successfully.',
                '',
                `sys_id:         ${sys_id}`,
                `Updated fields: ${Object.keys(body).join(', ') || 'none'}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: create test ────────────────────────────────────────────────────
  server.registerTool(
    'create_atf_test',
    {
      title: 'Create ATF Test',
      description: [
        'Creates an ATF test (sys_atf_test). Add steps with add_atf_step (in execution',
        'order). To run it, open the returned URL in ServiceNow — this server does not',
        'execute tests.',
        '',
        'Returns the test sys_id and URL.',
      ].join('\n'),
      inputSchema: AtfTestCreate.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, description, active, enable_parameterized_testing }) => {
      try {
        const body: Record<string, unknown> = { name, active: String(active) };
        if (description !== undefined) body.description = description;
        if (enable_parameterized_testing !== undefined)
          body.enable_parameterized_testing = String(
            enable_parameterized_testing,
          );
        const created = await client.createRecord<SnRecord>(TEST_TABLE, body);
        const sysId = val(created, 'sys_id');
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Test created successfully.',
                '',
                `Name:   ${name}`,
                `sys_id: ${sysId}`,
                `URL:    ${recordUrl(client, TEST_TABLE, sysId)}`,
                '',
                'Add steps with add_atf_step. Save the sys_id — each step needs it.',
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: update test (incl. soft-delete via active=false) ────────────────
  server.registerTool(
    'update_atf_test',
    {
      title: 'Update ATF Test',
      description: [
        'Updates an ATF test (sys_atf_test). Pass only fields to change.',
        'Set active=false to soft-delete the test — there is no hard delete.',
      ].join('\n'),
      inputSchema: AtfTestUpdate.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      sys_id,
      name,
      description,
      active,
      enable_parameterized_testing,
    }) => {
      try {
        if (!isSysId(sys_id)) {
          return errText(`"${sys_id}" is not a valid test sys_id.`);
        }
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (active !== undefined) body.active = String(active);
        if (enable_parameterized_testing !== undefined)
          body.enable_parameterized_testing = String(
            enable_parameterized_testing,
          );
        await client.patchRecord(TEST_TABLE, sys_id, body);
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Test updated successfully.',
                '',
                `sys_id:         ${sys_id}`,
                `Updated fields: ${Object.keys(body).join(', ') || 'none'}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: add test to suite ──────────────────────────────────────────────
  server.registerTool(
    'add_atf_test_to_suite',
    {
      title: 'Add ATF Test to Suite',
      description: [
        'Adds a test to a test suite (creates a sys_atf_test_suite_test link with an',
        'execution order). Requires the suite sys_id and the test sys_id.',
      ].join('\n'),
      inputSchema: AtfAddTestToSuite.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ test_suite, test, order }) => {
      try {
        if (!isSysId(test_suite))
          return errText(`"${test_suite}" is not a valid test suite sys_id.`);
        if (!isSysId(test))
          return errText(`"${test}" is not a valid test sys_id.`);
        const resolvedOrder =
          order ??
          (await nextOrder(
            client,
            SUITE_TEST_TABLE,
            `test_suite=${test_suite}`,
          ));
        const created = await client.createRecord<SnRecord>(SUITE_TEST_TABLE, {
          test_suite,
          test,
          order: String(resolvedOrder),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Test added to suite successfully.',
                '',
                `Link sys_id: ${val(created, 'sys_id')}`,
                `Order:       ${resolvedOrder}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: add a configured step to a test ─────────────────────────────────
  server.registerTool(
    'add_atf_step',
    {
      title: 'Add ATF Step',
      description: [
        'Adds a step to an ATF test (sys_atf_step) and configures its inputs in one',
        'call. The step is created immediately (its sys_id is returned now); input',
        'values are written by a server-side script and appear within a few seconds',
        '(ServiceNow ACLs block writing them directly over the API).',
        '',
        'IMPORTANT — you MUST call get_atf_step_config_schema before this tool.',
        'Element names are NOT guessable from UI labels: e.g. the "Record" field in',
        '"Open an Existing Record" has element `record_id`, not `record`. Using a',
        'wrong name will cause the tool to reject the input; omitting inputs entirely',
        'creates the step unconfigured. Always derive element names from the schema.',
        '',
        'Each input targets one element of the step config. An input is either a',
        'literal `value` or a dependency on an earlier step via `map_from_step`',
        "(that step's sys_id) + `map_output` (an output element of its config).",
        'The tool wires the dependency as the sys_id token form',
        "`{{step['<producer sys_id>'].<output element>}}`, the same token the",
        "UI's dot-walking picker writes. For whole-value maps into reference/",
        'document_id fields (e.g. the "Record" field of Open an Existing Record)',
        'it also writes the companion sys_element_mapping row that makes the token',
        'resolve at runtime — handled automatically, no extra input needed.',
        '',
        'Build a test top-down: add producer steps first, then reference the sys_id',
        'returned here as map_from_step on later steps. Returns the step sys_id and',
        "the output elements the new step exposes. Inputs you omit are auto-filled with the config's",
        'dictionary defaults (matching what the UI form saves); the tool warns when an',
        'assert-type input remains empty, because such a step asserts nothing.',
        '',
        'Coverage patterns: after a submit/insert step, consume its outputs (e.g.',
        'record_id) in a later server-side validation step. When verifying a',
        'conditional UI state (e.g. a catalog UI policy), first assert the INITIAL',
        'state with a state-validation step ordered BEFORE the step that triggers the',
        'change — otherwise the test passes even if the state was always on.',
      ].join('\n'),
      inputSchema: AtfAddStep.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ test, step_config, order, active, inputs }) => {
      try {
        if (!isSysId(test))
          return errText(`"${test}" is not a valid test sys_id.`);

        const { sysId: configSysId, name: configName } =
          await resolveStepConfig(client, step_config);
        const [defs, outputs, producers] = await Promise.all([
          fetchInputDefs(client, configSysId),
          fetchOutputDefs(client, configSysId),
          fetchProducers(client, inputs),
        ]);
        // Validate/resolve inputs before creating the step so a bad input
        // never leaves an orphan step behind.
        const resolved = inputs?.length
          ? resolveStepInputs(defs, inputs, producers)
          : [];

        // The UI pre-fills every input's dictionary default when the step form
        // renders, so a manual save persists them; API-created steps must write
        // them too or end up configured differently from UI-created ones (e.g.
        // Record Insert's assert_type silently empty → the step asserts nothing).
        // javascript: defaults are evaluated server-side at render time and
        // can't be replayed here.
        const provided = new Set(resolved.map((r) => r.element));
        const defaulted = defs.filter(
          (d) =>
            !provided.has(d.element) &&
            d.defaultValue !== '' &&
            !d.defaultValue.startsWith('javascript:'),
        );
        const allResolved: ResolvedInput[] = [
          ...resolved,
          ...defaulted.map((d) => ({
            element: d.element,
            variableSysId: d.sysId,
            value: d.defaultValue,
            order: d.order,
            needsElementMapping: false,
          })),
        ];

        const resolvedOrder =
          order ?? (await nextOrder(client, STEP_TABLE, `test=${test}`));

        const body: Record<string, unknown> = {
          test,
          step_config: configSysId,
          order: String(resolvedOrder),
        };
        if (active !== undefined) body.active = String(active);
        // Denormalise the table column from a literal "table" input, matching OOTB steps.
        const tableInput = inputs?.find(
          (i) => i.element === 'table' && i.value,
        );
        if (tableInput?.value) body.table = tableInput.value;

        const created = await client.createRecord<SnRecord>(STEP_TABLE, body);
        const stepSysId = val(created, 'sys_id');

        // sys_variable_value rejects REST writes (ACL); write inputs server-side
        // via a +1s trigger, then read them back so we report what actually
        // landed instead of optimistically assuming success.
        let inputStatus = 'Inputs:      none';
        let stored = new Map<string, string>();
        if (allResolved.length) {
          await client.executeBackgroundScriptTrigger(
            buildInputUpsertScript(stepSysId, allResolved, configSysId),
          );
          const verified = await verifyInputsWritten(
            client,
            stepSysId,
            allResolved,
          );
          stored = verified.stored;
          inputStatus = formatInputStatus(verified.pending, allResolved);
        }

        const missingMandatory = defs.filter(
          (d) =>
            d.mandatory && !allResolved.some((r) => r.element === d.element),
        );
        const assertWarnings = buildAssertWarnings(defs, stored);
        const defaultsLine = defaulted.length
          ? `Defaults:    ${defaulted.map((d) => `${d.element}=${d.defaultValue}`).join(', ')} (from step config)`
          : undefined;
        const outputLines = outputs.length
          ? [
              `Outputs:     ${outputs.map((o) => `${o.element} [${o.internalType}]`).join(', ')}`,
              `             Consume them in later steps via map_from_step=${stepSysId} + map_output`,
              '             (e.g. a server-side record validation after a submit/insert).',
            ]
          : ['Outputs:     none'];

        const schemaLines =
          missingMandatory.length > 0
            ? [
                '',
                `⚠ Mandatory inputs not yet set. Call update_atf_step with sys_id=${stepSysId}.`,
                `Full schema for "${configName}" — use these element names exactly:`,
                ...defs.map(
                  (d) =>
                    `  • ${d.element} (${d.label}) [${d.internalType}]${d.mandatory ? ' — MANDATORY' : ''}${d.reference ? ` → ${d.reference}` : ''}`,
                ),
              ]
            : [];

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Step added successfully.',
                '',
                `Test:        ${test}`,
                `Step config: ${configName}`,
                `Order:       ${resolvedOrder}`,
                `Step sys_id: ${stepSysId}`,
                inputStatus,
                defaultsLine,
                ...outputLines,
                ...assertWarnings,
                ...schemaLines,
              ]
                .filter((l): l is string => l !== undefined)
                .join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Write: update a step (reorder / activate / change inputs) ──────────────
  server.registerTool(
    'update_atf_step',
    {
      title: 'Update ATF Step',
      description: [
        'Updates an existing ATF step (sys_atf_step): reorder, activate/deactivate, or',
        'set/overwrite input values. Inputs are upserted by element — passing the same',
        'element again overwrites its stored value. Set active=false to soft-disable.',
      ].join('\n'),
      inputSchema: AtfUpdateStep.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, order, active, inputs }) => {
      try {
        if (!isSysId(sys_id))
          return errText(`"${sys_id}" is not a valid step sys_id.`);

        const step = await client.getRecord<SnRecord>(STEP_TABLE, sys_id, [
          'sys_id',
          'step_config',
        ]);
        const configSysId = val(step, 'step_config');

        const body: Record<string, unknown> = {};
        if (order !== undefined) body.order = String(order);
        if (active !== undefined) body.active = String(active);
        const tableInput = inputs?.find(
          (i) => i.element === 'table' && i.value,
        );
        if (tableInput?.value) body.table = tableInput.value;
        if (Object.keys(body).length > 0) {
          await client.patchRecord(STEP_TABLE, sys_id, body);
        }

        let inputStatus = 'Inputs:         none';
        let assertWarnings: string[] = [];
        if (inputs?.length) {
          const [defs, producers] = await Promise.all([
            fetchInputDefs(client, configSysId),
            fetchProducers(client, inputs),
          ]);
          const resolved = resolveStepInputs(defs, inputs, producers);
          // sys_variable_value rejects REST writes (ACL); write server-side via a
          // +1s trigger, then read back to confirm what actually landed.
          await client.executeBackgroundScriptTrigger(
            buildInputUpsertScript(sys_id, resolved, configSysId),
          );
          const verified = await verifyInputsWritten(client, sys_id, resolved);
          inputStatus = formatInputStatus(verified.pending, resolved);
          // The readback covers ALL of the step's values, so this flags assert
          // inputs that were empty before this update too, not just ones the
          // caller blanked now.
          assertWarnings = buildAssertWarnings(defs, verified.stored);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Step updated successfully.',
                '',
                `Step sys_id:    ${sys_id}`,
                `Updated fields: ${Object.keys(body).join(', ') || 'none'}`,
                inputStatus,
                ...assertWarnings,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}

function errText(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  };
}
