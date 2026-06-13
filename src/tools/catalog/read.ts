import { z } from 'zod';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import {
  type CatalogClientScript,
  type CatalogItemDefinition,
  type CatalogUiPolicy,
  type CatalogVariable,
  type RawCatalogItem,
  type RawChoice,
  type RawClientScript,
  type RawUiPolicy,
  type RawUiPolicyAction,
  type RawUserCriteria,
  type RawUserCriteriaRecord,
  type RawVariable,
  type SnCurrencyField,
  type SnReference,
  VARIABLE_TYPE_MAP,
} from '../../types/servicenow.js';
import {
  boolStr,
  errText,
  handleError,
  isSysId,
  resolveDisplay,
  resolveValue,
  textResult,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';

function normaliseVariable(raw: RawVariable): CatalogVariable {
  // raw.type is { value: "8", display_value: "Reference" } with sysparm_display_value=all;
  // we need the numeric code (.value) for VARIABLE_TYPE_MAP, not the human label
  const typeCode = resolveValue(raw.type);
  return {
    sys_id: resolveValue(raw.sys_id),
    name: resolveDisplay(raw.name),
    label:
      (raw.label ? resolveDisplay(raw.label) : '') || resolveDisplay(raw.name),
    type_code: typeCode,
    type_label: VARIABLE_TYPE_MAP[typeCode] ?? `Unknown (${typeCode})`,
    order: parseInt(resolveDisplay(raw.order) || '0', 10),
    mandatory: boolStr(raw.mandatory),
    active: boolStr(raw.active),
    hidden: boolStr(raw.hidden),
    read_only: boolStr(raw.read_only),
    default_value: resolveDisplay(raw.default_value) || '',
    help_text: resolveDisplay(raw.help_text) || '',
    reference_table: raw.reference ? resolveDisplay(raw.reference) : undefined,
    reference_qualifier: raw.reference_qual
      ? resolveValue(raw.reference_qual)
      : undefined,
    reference_qual_condition: raw.reference_qual_condition
      ? resolveValue(raw.reference_qual_condition)
      : undefined,
    use_reference_qualifier: raw.use_reference_qualifier
      ? resolveDisplay(raw.use_reference_qualifier)
      : undefined,
    lookup_table: raw.lookup_table
      ? resolveDisplay(raw.lookup_table)
      : undefined,
    list_table: raw.list_table ? resolveDisplay(raw.list_table) : undefined,
    variable_set: raw.variable_set
      ? resolveDisplay(raw.variable_set)
      : undefined,
  };
}

interface PlannedVariable {
  name: string;
  type: string;
  use_reference_qualifier?: 'simple' | 'advanced';
  mandatory?: boolean;
  read_only?: boolean;
  hidden?: boolean;
}

function isCompatible(
  planned: PlannedVariable,
  existing: RawVariable,
): boolean {
  const existingType = resolveValue(existing.type);
  if (existingType !== planned.type) return false;
  if (
    planned.mandatory !== undefined &&
    boolStr(existing.mandatory) !== planned.mandatory
  )
    return false;
  if (
    planned.read_only !== undefined &&
    boolStr(existing.read_only) !== planned.read_only
  )
    return false;
  if (
    planned.hidden !== undefined &&
    boolStr(existing.hidden) !== planned.hidden
  )
    return false;
  if (planned.use_reference_qualifier !== undefined) {
    const existingUseRq = existing.use_reference_qualifier
      ? resolveDisplay(existing.use_reference_qualifier)
      : '';
    if (existingUseRq !== planned.use_reference_qualifier) return false;
  }
  return true;
}

async function fetchCatalogItemDefinition(
  client: ServiceNowClient,
  rawSysId: string,
): Promise<CatalogItemDefinition> {
  const sysId = await client.resolveCatalogItemSysId(rawSysId);
  const item = await client.getRecord<RawCatalogItem>('sc_cat_item', sysId);

  const [
    rawVariables,
    rawUiPolicies,
    rawClientScripts,
    rawUserCriteria,
    rawVariableSets,
  ] = await Promise.all([
    client.listRecords<RawVariable>(
      'item_option_new',
      `cat_item=${sysId}^active=true^ORDERBYorder`,
      undefined,
      200,
    ),
    client.listRecords<RawUiPolicy>(
      'catalog_ui_policy',
      `catalog_item=${sysId}^active=true^ORDERBYorder`,
      undefined,
      100,
    ),
    client.listRecords<RawClientScript>(
      'catalog_script_client',
      `cat_item=${sysId}^active=true`,
      undefined,
      100,
    ),
    client.listRecords<RawUserCriteria>(
      'sc_cat_item_user_criteria_mtom',
      `sc_cat_item=${sysId}`,
      undefined,
      50,
    ),
    client.listRecords<{ variable_set: SnReference; order: SnReference }>(
      'io_set_item',
      `sc_cat_item=${sysId}`,
      ['variable_set', 'order'],
      50,
    ),
  ]);

  const allActions =
    rawUiPolicies.length > 0
      ? await client.listRecords<RawUiPolicyAction>(
          'catalog_ui_policy_action',
          `ui_policyIN${rawUiPolicies.map((p) => resolveValue(p.sys_id)).join(',')}`,
          undefined,
          500,
        )
      : [];

  const normalizedVars = rawVariables.map(normaliseVariable);

  const choiceTargets = normalizedVars
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.type_code === '3' || v.type_code === '5');

  if (choiceTargets.length > 0) {
    const choiceFetches = await Promise.all(
      choiceTargets.map(async ({ v, i }) => ({
        index: i,
        choices: await client.listRecords<RawChoice>(
          'question_choice',
          `question=${v.sys_id}^ORDERBYorder`,
          ['sys_id', 'text', 'value', 'order'],
          100,
        ),
      })),
    );
    for (const { index, choices } of choiceFetches) {
      normalizedVars[index].choices = choices.map((c) => ({
        sys_id: resolveValue(c.sys_id),
        text: resolveDisplay(c.text),
        value: resolveDisplay(c.value),
        order: parseInt(resolveDisplay(c.order) || '0', 10),
      }));
    }
  }

  const varNameBySysId = new Map<string, string>();
  for (const v of rawVariables) {
    varNameBySysId.set(resolveValue(v.sys_id), resolveDisplay(v.name));
  }

  const uiPoliciesWithActions: CatalogUiPolicy[] = rawUiPolicies.map(
    (policy) => {
      const policySysId = resolveValue(policy.sys_id);
      return {
        sys_id: policySysId,
        name: policy.short_description
          ? resolveDisplay(policy.short_description)
          : policy.name
            ? resolveDisplay(policy.name)
            : '(unnamed)',
        conditions: policy.catalog_conditions
          ? resolveValue(policy.catalog_conditions)
          : '',
        on_load: boolStr(policy.on_load),
        reverse_if_false: boolStr(policy.reverse_if_false),
        active: boolStr(policy.active),
        order: parseInt(resolveDisplay(policy.order) || '0', 10),
        actions: allActions
          .filter((a) => resolveValue(a.ui_policy) === policySysId)
          .map((a) => {
            const catVar = a.catalog_variable
              ? resolveValue(a.catalog_variable)
              : '';
            const varSysId = catVar.startsWith('IO:')
              ? catVar.slice(3)
              : catVar;
            return {
              sys_id: resolveValue(a.sys_id),
              catalog_variable: catVar,
              variable_name: varNameBySysId.get(varSysId) ?? catVar,
              visible: resolveValue(a.visible),
              mandatory: resolveValue(a.mandatory),
              disabled: resolveValue(a.disabled),
              value_action: a.value_action
                ? resolveValue(a.value_action) || undefined
                : undefined,
              value: a.value ? resolveValue(a.value) || undefined : undefined,
              field_message_type: a.field_message_type
                ? resolveValue(a.field_message_type) || undefined
                : undefined,
              field_message: a.field_message
                ? resolveValue(a.field_message) || undefined
                : undefined,
            };
          }),
      };
    },
  );

  const clientScripts: CatalogClientScript[] = rawClientScripts.map((cs) => ({
    sys_id: resolveValue(cs.sys_id),
    name: resolveDisplay(cs.name),
    type: resolveDisplay(cs.type),
    variable_name: cs.variable_name
      ? resolveValue(cs.variable_name)
      : undefined,
    active: boolStr(cs.active),
    script: resolveValue(cs.script),
  }));

  return {
    sys_id: resolveValue(item.sys_id),
    name: resolveDisplay(item.name),
    short_description: resolveDisplay(item.short_description),
    description: resolveDisplay(item.description),
    active: boolStr(item.active),
    order: parseInt(resolveDisplay(item.order) || '0', 10),
    price: resolveDisplay(item.price),
    category: resolveDisplay(item.category),
    scope: resolveDisplay(item.sys_scope),
    fulfillment_flow: item.workflow_id
      ? resolveDisplay(item.workflow_id)
      : undefined,
    variables: normalizedVars,
    ui_policies: uiPoliciesWithActions,
    client_scripts: clientScripts,
    user_criteria: rawUserCriteria.map((uc) =>
      resolveDisplay(uc.user_criteria),
    ),
    variable_sets: rawVariableSets.map((vs) => ({
      sys_id: resolveValue(vs.variable_set),
      name: resolveDisplay(vs.variable_set),
      order: parseInt(resolveDisplay(vs.order) || '0', 10),
    })),
    _raw_sys_id: sysId,
  };
}

function buildSummary(def: CatalogItemDefinition): string {
  const lines: string[] = [
    `# Catalog Item: ${def.name}`,
    `sys_id: ${def.sys_id}`,
    `Active: ${def.active} | Category: ${def.category} | Scope: ${def.scope}`,
    `Price: ${def.price}`,
    def.fulfillment_flow ? `Fulfillment flow: ${def.fulfillment_flow}` : '',
    '',
    `## Short description`,
    def.short_description || '(none)',
    '',
    `## Variable Sets (${def.variable_sets.length})`,
  ];

  if (def.variable_sets.length === 0) {
    lines.push('  (none)');
  } else {
    for (const vs of def.variable_sets) {
      lines.push(`  • ${vs.name}  sys_id: ${vs.sys_id}  order: ${vs.order}`);
    }
  }

  lines.push('', `## Standalone Variables (${def.variables.length})`);

  if (def.variables.length === 0) {
    lines.push('  (none)');
  } else {
    for (const v of def.variables) {
      const flags = [
        v.mandatory ? 'mandatory' : '',
        v.hidden ? 'hidden' : '',
        v.read_only ? 'read_only' : '',
      ]
        .filter(Boolean)
        .join(', ');
      const varLine =
        `  ${String(v.order).padStart(3)}. [${v.type_label}] ${v.label}  (name: ${v.name})` +
        (flags ? `  [${flags}]` : '') +
        (v.reference_table ? `  → refs ${v.reference_table}` : '');
      const varSubLines = [`       sys_id: ${v.sys_id}`];
      if (v.choices && v.choices.length > 0) {
        varSubLines.push(`       choices:`);
        for (const c of v.choices) {
          varSubLines.push(
            `         - sys_id: ${c.sys_id}  text: "${c.text}"   value: ${c.value}   order: ${c.order}`,
          );
        }
      }
      lines.push(`${varLine}\n${varSubLines.join('\n')}`);
    }
  }

  lines.push('', `## UI Policies (${def.ui_policies.length})`);
  if (def.ui_policies.length === 0) {
    lines.push('  (none)');
  } else {
    for (const p of def.ui_policies) {
      lines.push(
        `  "${p.name}"  sys_id: ${p.sys_id}`,
        `    conditions: ${p.conditions || '(always)'}`,
      );
      for (const a of p.actions) {
        lines.push(
          `    → ${a.variable_name}  [action sys_id: ${a.sys_id}]` +
            `\n      catalog_variable: ${a.catalog_variable}` +
            `\n      visible=${a.visible}  mandatory=${a.mandatory}  disabled=${a.disabled}` +
            (a.value_action && a.value_action !== 'ignore'
              ? `  value_action=${a.value_action}`
              : ''),
        );
      }
    }
  }

  lines.push('', `## Client Scripts (${def.client_scripts.length})`);
  if (def.client_scripts.length === 0) {
    lines.push('  (none)');
  } else {
    for (const cs of def.client_scripts) {
      lines.push(
        `  [${cs.type}] ${cs.name}  sys_id: ${cs.sys_id}` +
          (cs.variable_name ? `  (on variable: ${cs.variable_name})` : ''),
      );
    }
  }

  lines.push('', `## User Criteria (${def.user_criteria.length})`);
  if (def.user_criteria.length === 0) {
    lines.push('  (none — visible to everyone)');
  } else {
    for (const uc of def.user_criteria) {
      lines.push(`  • ${uc}`);
    }
  }

  return lines.filter(Boolean).join('\n');
}

export function registerCatalogReadTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'get_catalog_item_definition',
    {
      access: 'read',
      title: 'Get Catalog Item Definition',
      description: [
        'Fetches the full definition of a ServiceNow catalog item including:',
        '  • All variables (name, type, order, mandatory, defaults, reference tables)',
        '  • UI policies and their per-variable actions (show/hide/mandatory/disabled)',
        '  • Client scripts (onLoad, onChange, onSubmit) with full script bodies',
        '  • User criteria (who can see and order this item)',
        '  • Core item metadata (category, scope, price, active status)',
        '',
        'Pass the item sys_id (32-char hex) OR a partial/full item name.',
        'If a name matches multiple items, the tool will ask you to be more specific.',
      ].join('\n'),
      inputSchema: {
        id_or_name: z
          .string()
          .min(1)
          .describe(
            "Catalog item sys_id (e.g. '1c2d3e4f...') OR item name (e.g. 'Laptop Request'). " +
              'Partial names are supported.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ id_or_name }) => {
      try {
        const definition = await fetchCatalogItemDefinition(client, id_or_name);
        const summary = buildSummary(definition);
        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_catalog_items',
    {
      access: 'read',
      title: 'List Catalog Items',
      description: [
        'Search for catalog items on the ServiceNow instance.',
        'Returns a lightweight list (sys_id, name, short_description, category, active).',
        'Use get_catalog_item_definition to fetch full detail for a specific item.',
        '',
        'IMPORTANT: category_sys_id must be a 32-char hex sys_id, NOT a name.',
        'If you only have a category name, call list_catalog_categories first.',
      ].join('\n'),
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Filter by partial name or description.'),
        category_sys_id: z
          .string()
          .optional()
          .describe(
            'Filter by category sys_id (32-char hex). ' +
              'Call list_catalog_categories first if you only have a category name.',
          ),
        include_inactive: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include inactive items. Defaults to false.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe('Max results (1-100). Defaults to 20.'),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ search, category_sys_id, include_inactive, limit }) => {
      try {
        if (category_sys_id && !isSysId(category_sys_id)) {
          return errText(
            `"${category_sys_id}" is not a valid sys_id. ` +
              `Call list_catalog_categories to find the sys_id for that category name.`,
          );
        }

        const conditions: string[] = [];
        if (!include_inactive) conditions.push('active=true');
        if (search)
          conditions.push(`nameLIKE${search}^ORshort_descriptionLIKE${search}`);
        if (category_sys_id) conditions.push(`category=${category_sys_id}`);

        const query = conditions.join('^') || 'active=true';

        const items = await client.listRecords<{
          sys_id: SnReference;
          name: SnReference;
          short_description: SnReference;
          category: SnReference;
          active: SnReference;
          price: SnCurrencyField;
        }>(
          'sc_cat_item',
          query,
          [
            'sys_id',
            'name',
            'short_description',
            'category',
            'active',
            'price',
          ],
          limit,
        );

        if (items.length === 0) {
          return textResult(
            'No catalog items found matching the given criteria.',
          );
        }

        const lines = [
          `Found ${items.length} catalog item(s):`,
          '',
          ...items.map((item) =>
            [
              `• ${resolveDisplay(item.name)}`,
              `  sys_id: ${resolveValue(item.sys_id)}`,
              `  category: ${resolveDisplay(item.category)}`,
              `  active: ${resolveValue(item.active)}`,
              `  price: ${resolveDisplay(item.price) || '0'}`,
              `  ${resolveDisplay(item.short_description) || '(no description)'}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
          '',
          'Tip: call get_catalog_item_definition with a sys_id to see the full detail.',
        ];

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_catalog_categories',
    {
      access: 'read',
      title: 'List Catalog Categories',
      description: [
        'Search for ServiceNow catalog categories and return their sys_ids and names.',
        '',
        'WHEN TO USE: Call this before list_catalog_items whenever the user refers to',
        "a category by name (e.g. 'Hardware', 'Software', 'IT Services').",
        'list_catalog_items requires a category sys_id — this tool resolves the name.',
        '',
        'Returns: sys_id, title, description, parent category for each match.',
      ].join('\n'),
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            'Partial category name to search for. Leave empty to list all categories.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ search }) => {
      try {
        const query = search
          ? `titleLIKE${search}^ORdescriptionLIKE${search}`
          : 'active=true';

        const categories = await client.listRecords<{
          sys_id: SnReference;
          title: SnReference;
          description: SnReference;
          parent: SnReference;
          active: SnReference;
        }>(
          'sc_category',
          query,
          ['sys_id', 'title', 'description', 'parent', 'active'],
          50,
        );

        if (categories.length === 0) {
          return textResult(
            search
              ? `No categories found matching "${search}".`
              : 'No categories found on this instance.',
          );
        }

        const lines = [
          `Found ${categories.length} category/categories:`,
          '',
          ...categories.map((c) =>
            [
              `• ${resolveDisplay(c.title)}`,
              `  sys_id: ${resolveValue(c.sys_id)}`,
              c.parent ? `  parent: ${resolveDisplay(c.parent)}` : '',
              `  ${resolveDisplay(c.description) || '(no description)'}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
          '',
          'Tip: pass the sys_id into list_catalog_items as category_sys_id.',
        ];

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_catalogs',
    {
      access: 'read',
      title: 'List Service Catalogs',
      description: [
        'Search for ServiceNow service catalogs and return their sys_ids and titles.',
        '',
        'WHEN TO USE: Call this before create_catalog_item or update_catalog_item whenever',
        "the user refers to a catalog by name (e.g. 'Service Catalog', 'IT Catalog').",
        'Both write tools require a catalog_sys_id — this tool resolves the name to one.',
        '',
        'Returns: sys_id, title, description for each match.',
      ].join('\n'),
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            'Partial catalog name to search for. Leave empty to list all catalogs.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ search }) => {
      try {
        const query = search
          ? `titleLIKE${search}^ORdescriptionLIKE${search}`
          : 'active=true';

        const catalogs = await client.listRecords<{
          sys_id: SnReference;
          title: SnReference;
          description: SnReference;
        }>('sc_catalog', query, ['sys_id', 'title', 'description'], 50);

        if (catalogs.length === 0) {
          return textResult(
            search
              ? `No catalogs found matching "${search}".`
              : 'No catalogs found on this instance.',
          );
        }

        const lines = [
          `Found ${catalogs.length} catalog(s):`,
          '',
          ...catalogs.map((c) =>
            [
              `• ${resolveDisplay(c.title)}`,
              `  sys_id: ${resolveValue(c.sys_id)}`,
              `  ${resolveDisplay(c.description) || '(no description)'}`,
            ].join('\n'),
          ),
          '',
          'Tip: pass the sys_id into create_catalog_item or update_catalog_item as catalog_sys_id.',
        ];

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_flows',
    {
      access: 'read',
      title: 'List Flow Designer Flows',
      description: [
        'Search for ServiceNow Flow Designer flows and return their sys_ids and names.',
        '',
        'WHEN TO USE: Call this before create_catalog_item or update_catalog_item whenever',
        'the user refers to a Flow Designer flow by name.',
        'Both write tools require the flow sys_id in flow_designer_flow — this tool resolves the name.',
        '',
        'Returns: sys_id, name, description for each match.',
      ].join('\n'),
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            'Partial flow name to search for. Leave empty to list all flows.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ search }) => {
      try {
        const query = search
          ? `nameLIKE${search}^ORdescriptionLIKE${search}`
          : 'active=true';

        const flows = await client.listRecords<{
          sys_id: SnReference;
          name: SnReference;
          description: SnReference;
        }>('sys_hub_flow', query, ['sys_id', 'name', 'description'], 50);

        if (flows.length === 0) {
          return textResult(
            search
              ? `No flows found matching "${search}".`
              : 'No flows found on this instance.',
          );
        }

        const lines = [
          `Found ${flows.length} flow(s):`,
          '',
          ...flows.map((f) =>
            [
              `• ${resolveDisplay(f.name)}`,
              `  sys_id: ${resolveValue(f.sys_id)}`,
              `  ${resolveDisplay(f.description) || '(no description)'}`,
            ].join('\n'),
          ),
          '',
          'Tip: pass the sys_id into create_catalog_item or update_catalog_item as flow_designer_flow.',
        ];

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_workflows',
    {
      access: 'read',
      title: 'List Classic Workflows',
      description: [
        'Search for ServiceNow classic Workflows and return their sys_ids and names.',
        '',
        'WHEN TO USE: Call this before create_catalog_item or update_catalog_item whenever',
        'the user refers to a classic Workflow by name.',
        'Both write tools require the workflow sys_id in workflow — this tool resolves the name.',
        '',
        'NOTE: Prefer flow_designer_flow for new items. Use this only for legacy workflows.',
        '',
        'Returns: sys_id, name, description for each match.',
      ].join('\n'),
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            'Partial workflow name to search for. Leave empty to list all workflows.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ search }) => {
      try {
        const query = search
          ? `nameLIKE${search}^ORdescriptionLIKE${search}`
          : 'active=true';

        const workflows = await client.listRecords<{
          sys_id: SnReference;
          name: SnReference;
          description: SnReference;
        }>('wf_workflow', query, ['sys_id', 'name', 'description'], 50);

        if (workflows.length === 0) {
          return textResult(
            search
              ? `No workflows found matching "${search}".`
              : 'No workflows found on this instance.',
          );
        }

        const lines = [
          `Found ${workflows.length} workflow(s):`,
          '',
          ...workflows.map((w) =>
            [
              `• ${resolveDisplay(w.name)}`,
              `  sys_id: ${resolveValue(w.sys_id)}`,
              `  ${resolveDisplay(w.description) || '(no description)'}`,
            ].join('\n'),
          ),
          '',
          'Tip: pass the sys_id into create_catalog_item or update_catalog_item as workflow.',
        ];

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'resolve_table',
    {
      access: 'read',
      title: 'Resolve Table sys_id',
      description: [
        'Looks up a ServiceNow table and returns its internal name and label.',
        '',
        'WHEN TO USE: before create_catalog_variable when type=8 (Reference) or',
        'type=21 (List Collector) and you are unsure of the exact internal table name.',
        "The internal name (e.g. 'sys_user_group') is what you pass to reference_table",
        'or list_table — NOT the sys_id.',
        '',
        'Pass the exact internal name for a precise match, or a partial string to',
        'search by name or label across all tables.',
        '',
        'Returns: internal name, human-readable label, and sys_id for each match.',
      ].join('\n'),
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            "Internal table name (e.g. 'sys_user') for an exact match, " +
              'or a partial string to search by name or label.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ name }) => {
      try {
        const exact = await client.listRecords<{
          sys_id: SnReference;
          name: SnReference;
          label: SnReference;
        }>('sys_db_object', `name=${name}`, ['sys_id', 'name', 'label'], 1);

        if (exact.length === 1) {
          const t = exact[0];
          return textResult(
            [
              `Table resolved.`,
              ``,
              `Name:   ${resolveDisplay(t.name)}`,
              `Label:  ${resolveDisplay(t.label)}`,
              `sys_id: ${resolveValue(t.sys_id)}`,
            ].join('\n'),
          );
        }

        const results = await client.listRecords<{
          sys_id: SnReference;
          name: SnReference;
          label: SnReference;
        }>(
          'sys_db_object',
          `nameLIKE${name}^ORlabelLIKE${name}`,
          ['sys_id', 'name', 'label'],
          20,
        );

        if (results.length === 0) {
          return textResult(`No table found matching "${name}".`);
        }

        const lines = [
          `Found ${results.length} table(s) matching "${name}":`,
          '',
          ...results.map((t) =>
            [
              `• ${resolveDisplay(t.label)} (${resolveDisplay(t.name)})`,
              `  sys_id: ${resolveValue(t.sys_id)}`,
            ].join('\n'),
          ),
          '',
          'Tip: re-call with the exact internal name for a single match.',
        ];

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_variable_set_variables',
    {
      access: 'read',
      title: 'List Variable Set Variables',
      description: [
        'Searches item_option_new records across the WHOLE platform that belong',
        'to variable sets — not scoped to any specific catalog item.',
        '',
        'WHEN TO USE: manual inspection and debugging only.',
        'For the variable creation flow, use find_reusable_variables instead —',
        'it performs the full nameIN search, scoring, and set selection server-side.',
        '',
        'Pass names to batch-search multiple variable names in one call.',
        'Pass variable_set_sys_id to list all variables in a specific known set.',
      ].join('\n'),
      inputSchema: {
        variable_set_sys_id: z
          .string()
          .optional()
          .describe(
            'sys_id of a specific variable set to inspect. Returns all its active variables.',
          ),
        names: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'List of variable names to search for across all variable sets on the platform. Generates a single nameIN query — pass all planned names at once.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ variable_set_sys_id, names }) => {
      try {
        if (!variable_set_sys_id && (!names || names.length === 0)) {
          return errText(
            'Provide at least one of: variable_set_sys_id or names.',
          );
        }

        const conditions: string[] = ['variable_set!=NULL', 'active=true'];
        if (variable_set_sys_id)
          conditions.push(`variable_set=${variable_set_sys_id}`);
        if (names && names.length > 0)
          conditions.push(`nameIN${names.join(',')}`);

        const vars = await client.listRecords<RawVariable>(
          'item_option_new',
          `${conditions.join('^')}^ORDERBYvariable_set^ORDERBYorder`,
          [
            'sys_id',
            'name',
            'label',
            'question_text',
            'type',
            'order',
            'mandatory',
            'variable_set',
          ],
          200,
        );

        if (vars.length === 0) {
          return textResult(
            names && names.length > 0
              ? `No variable set variables found matching [${names.join(', ')}]. All must be created standalone.`
              : 'No active variables found in this variable set.',
          );
        }

        // Group by variable set — use .value (sys_id) as the map key, not display_value
        const bySet = new Map<
          string,
          { setId: string; setName: string; rows: RawVariable[] }
        >();
        for (const v of vars) {
          const setId = v.variable_set?.value ?? '';
          const setName = v.variable_set?.display_value ?? setId;
          if (!bySet.has(setId)) bySet.set(setId, { setId, setName, rows: [] });
          bySet.get(setId)?.rows.push(v);
        }

        const lines: string[] = [
          `Found ${vars.length} variable(s) across ${bySet.size} variable set(s).`,
          '',
          'IMPORTANT: if any variable name below matches one you intend to create,',
          'ask the user whether to reuse it (associate its variable set) or create',
          'a standalone duplicate.',
          '',
        ];

        for (const [, { setId, setName, rows }] of bySet) {
          lines.push(`## Variable Set: ${setName}`);
          lines.push(`   sys_id: ${setId}`);
          for (const v of rows) {
            const typeLabel = resolveDisplay(v.type);
            const label =
              (v.label ? resolveDisplay(v.label) : '') ||
              (v.question_text ? resolveDisplay(v.question_text) : '') ||
              resolveDisplay(v.name);
            const mandatory = boolStr(v.mandatory) ? 'mandatory' : 'optional';
            lines.push(
              `  • ${resolveDisplay(v.name)} — ${label} [${typeLabel}] | ${mandatory}`,
            );
          }
          lines.push('');
        }

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'find_user_criteria',
    {
      access: 'read',
      title: 'Find User Criteria',
      description: [
        'Searches the user_criteria table for existing records that can be attached to a catalog item.',
        '',
        'WHEN TO USE: Call this BEFORE attach_user_criteria whenever the user mentions',
        "access restrictions ('visible to', 'restricted to', 'not for', 'exclude', 'block', 'hide from').",
        'NEVER call attach_user_criteria without searching first and getting explicit user confirmation.',
        '',
        'Pass name and/or short_description as partial search terms (LIKE match).',
        'Both filters are ANDed together when both are provided.',
        'At least one filter is required.',
        '',
        'After receiving results, ALWAYS present them to the user and ask for confirmation',
        'before calling attach_user_criteria.',
      ].join('\n'),
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe(
            "Partial name to search (nameLIKE). Use keywords from the user's prompt.",
          ),
        short_description: z
          .string()
          .optional()
          .describe(
            'Partial short description to search (short_descriptionLIKE).',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ name, short_description }) => {
      try {
        const UC_FIELDS = [
          'sys_id',
          'name',
          'short_description',
          'active',
          'role',
          'group',
          'department',
          'location',
          'company',
          'user',
          'advanced',
          'script',
        ];

        if (!name && !short_description) {
          return errText(
            'Provide at least one filter: name or short_description.',
          );
        }

        const parts = ['active=true'];
        if (name) parts.push(`nameLIKE${name}`);
        if (short_description)
          parts.push(`short_descriptionLIKE${short_description}`);

        const results = await client.listRecords<RawUserCriteriaRecord>(
          'user_criteria',
          parts.join('^'),
          UC_FIELDS,
          50,
        );

        if (results.length === 0) {
          return textResult('No user criteria found matching your search.');
        }

        const lines: string[] = [
          `Found ${results.length} user criteria.`,
          '',
          'IMPORTANT: Present these results to the user and ask which one to use.',
          'NEVER call attach_user_criteria without explicit user confirmation.',
          '',
        ];

        for (let i = 0; i < results.length; i++) {
          const uc = results[i];
          const sysId = resolveValue(uc.sys_id);
          const isScripted = uc.advanced ? boolStr(uc.advanced) : false;

          lines.push(`${i + 1}. ${resolveDisplay(uc.name)}`);
          lines.push(`   sys_id: ${sysId}`);
          lines.push(
            `   Description: ${uc.short_description ? resolveDisplay(uc.short_description) : '(none)'}`,
          );

          if (isScripted) {
            lines.push(`   Type: Scripted`);
            if (uc.script) lines.push(`   Script: ${resolveValue(uc.script)}`);
          } else {
            const dims: string[] = [];
            if (uc.role && resolveDisplay(uc.role))
              dims.push(`role: ${resolveDisplay(uc.role)}`);
            if (uc.group && resolveDisplay(uc.group))
              dims.push(`group: ${resolveDisplay(uc.group)}`);
            if (uc.department && resolveDisplay(uc.department))
              dims.push(`department: ${resolveDisplay(uc.department)}`);
            if (uc.location && resolveDisplay(uc.location))
              dims.push(`location: ${resolveDisplay(uc.location)}`);
            if (uc.company && resolveDisplay(uc.company))
              dims.push(`company: ${resolveDisplay(uc.company)}`);
            if (uc.user && resolveDisplay(uc.user))
              dims.push(`user: ${resolveDisplay(uc.user)}`);
            if (dims.length > 0) lines.push(`   Fields: ${dims.join(', ')}`);
          }
          lines.push('');
        }

        const jsonData = results.map((uc) => ({
          sys_id: resolveValue(uc.sys_id),
          name: resolveDisplay(uc.name),
          short_description: uc.short_description
            ? resolveDisplay(uc.short_description)
            : '',
          advanced: uc.advanced ? boolStr(uc.advanced) : false,
          script: uc.script ? resolveValue(uc.script) : undefined,
          role: uc.role ? resolveDisplay(uc.role) || undefined : undefined,
          group: uc.group ? resolveDisplay(uc.group) || undefined : undefined,
          department: uc.department
            ? resolveDisplay(uc.department) || undefined
            : undefined,
          location: uc.location
            ? resolveDisplay(uc.location) || undefined
            : undefined,
          company: uc.company
            ? resolveDisplay(uc.company) || undefined
            : undefined,
          user: uc.user ? resolveDisplay(uc.user) || undefined : undefined,
        }));

        return {
          content: [
            { type: 'text' as const, text: lines.join('\n') },
            {
              type: 'text' as const,
              text: `\n\n---\nJSON:\n${JSON.stringify(jsonData, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'find_reusable_variables',
    {
      access: 'read',
      title: 'Find Reusable Variables',
      description: [
        'Call ONCE with ALL planned variables after create_catalog_item.',
        'Searches the platform for variable sets that can be reused (associated) instead',
        'of creating duplicate standalone variables.',
        '',
        'After receiving results, present the full plan to the user and WAIT for',
        'explicit confirmation before calling associate_variable_set or create_catalog_variable.',
        '',
        'NEVER call associate_variable_set or create_catalog_variable until the user confirms.',
      ].join('\n'),
      inputSchema: {
        variables: z
          .array(
            z.object({
              name: z
                .string()
                .min(1)
                .describe('Planned variable internal name.'),
              type: z
                .string()
                .min(1)
                .describe("Numeric type code, e.g. '6' = Single Line Text."),
              use_reference_qualifier: z
                .enum(['simple', 'advanced'])
                .optional()
                .describe(
                  'Only set if the variable has a reference qualifier mode.',
                ),
              mandatory: z.boolean().optional(),
              read_only: z.boolean().optional(),
              hidden: z.boolean().optional(),
            }),
          )
          .min(1)
          .describe(
            'All planned variables for the catalog item in a single call.',
          ),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ variables }) => {
      try {
        const VAR_FIELDS = [
          'sys_id',
          'name',
          'label',
          'question_text',
          'type',
          'order',
          'mandatory',
          'read_only',
          'hidden',
          'use_reference_qualifier',
          'reference_qual',
          'variable_set',
          'active',
          'default_value',
          'help_text',
          'reference',
          'lookup_table',
          'list_table',
          'max_length',
          'reference_qual_condition',
        ];

        const plannedNames = variables.map((v) => v.name);
        const plannedByName = new Map(variables.map((v) => [v.name, v]));

        const nameHits = await client.listRecords<RawVariable>(
          'item_option_new',
          `nameIN${plannedNames.join(',')}^variable_setISNOTEMPTY^active=true`,
          VAR_FIELDS,
          200,
        );

        const setIds = new Set<string>();
        for (const v of nameHits) {
          const sid = v.variable_set?.value;
          if (sid) setIds.add(sid);
        }

        if (setIds.size === 0) {
          const textLines = [
            'No variable sets found matching any of the planned variable names.',
            'All variables must be created standalone.',
            '',
            'IMPORTANT: Present this plan to the user and wait for explicit confirmation',
            'before calling create_catalog_variable.',
            '',
            '## Proposed Plan',
            '',
            '### Create Standalone (create_catalog_variable)',
            ...plannedNames.map((name) => {
              // biome-ignore lint/style/noNonNullAssertion: plannedNames is derived from plannedByName.keys()
              const pv = plannedByName.get(name)!;
              const typeLabel =
                VARIABLE_TYPE_MAP[pv.type] ?? `Unknown (${pv.type})`;
              return (
                `  • ${name} — type: ${typeLabel} (${pv.type})` +
                (pv.mandatory ? ' | mandatory' : '')
              );
            }),
            '',
            'Ask the user: "Does this plan look correct? Should I proceed?"',
          ];
          return {
            content: [
              { type: 'text' as const, text: textLines.join('\n') },
              {
                type: 'text' as const,
                text:
                  '\n\n---\nJSON:\n' +
                  JSON.stringify(
                    { reuse: [], standalone: plannedNames },
                    null,
                    2,
                  ),
              },
            ],
          };
        }

        const setFetches = await Promise.all(
          [...setIds].map(async (setId) => ({
            setId,
            rows: await client.listRecords<RawVariable>(
              'item_option_new',
              `variable_set=${setId}^active=true^ORDERBYorder`,
              VAR_FIELDS,
              200,
            ),
          })),
        );

        const scoredSets = setFetches.map(({ setId, rows }) => {
          const matchingHit = nameHits.find(
            (h) => h.variable_set?.value === setId,
          );
          const setName = matchingHit?.variable_set?.display_value ?? setId;

          const covered = rows
            .map((r) => resolveDisplay(r.name))
            .filter((name) => {
              const pv = plannedByName.get(name);
              if (!pv) return false;
              // biome-ignore lint/style/noNonNullAssertion: name came from rows.map so find always succeeds
              const row = rows.find((r) => resolveDisplay(r.name) === name)!;
              return isCompatible(pv, row);
            });

          const score = rows.length === 0 ? 0 : covered.length / rows.length;
          return { setId, setName, covered, rows, score };
        });

        const qualifying = scoredSets
          .filter((s) => s.score === 1.0)
          .sort((a, b) => b.covered.length - a.covered.length);

        const selected: typeof qualifying = [];
        const resolved = new Set<string>();

        for (const set of qualifying) {
          if (set.covered.some((name) => !resolved.has(name))) {
            selected.push(set);
            for (const name of set.covered) resolved.add(name);
          }
        }

        const standalone = plannedNames.filter((name) => !resolved.has(name));

        const lines: string[] = [
          `Found ${selected.length} reusable variable set(s). ${standalone.length} variable(s) must be created standalone.`,
          '',
          'IMPORTANT: Present this plan to the user and wait for explicit confirmation',
          'before calling associate_variable_set or create_catalog_variable.',
          '',
          '## Proposed Plan',
          '',
        ];

        if (selected.length > 0) {
          lines.push('### Reuse Variable Sets (associate_variable_set)', '');
          for (const set of selected) {
            lines.push(
              `**"${set.setName}"** (sys_id: ${set.setId}) — covers: ${set.covered.join(', ')}`,
            );
            lines.push('  Variables in this set:');
            for (const row of set.rows) {
              const typeCode = resolveValue(row.type);
              const typeLabel =
                VARIABLE_TYPE_MAP[typeCode] ?? `Unknown (${typeCode})`;
              const name = resolveDisplay(row.name);
              const label =
                (row.label ? resolveDisplay(row.label) : '') ||
                (row.question_text ? resolveDisplay(row.question_text) : '') ||
                name;
              const mandatory = boolStr(row.mandatory)
                ? 'mandatory'
                : 'optional';
              const order = parseInt(resolveDisplay(row.order) || '0', 10);
              const flags = [
                boolStr(row.read_only) ? 'read_only' : '',
                boolStr(row.hidden) ? 'hidden' : '',
              ]
                .filter(Boolean)
                .join(', ');
              lines.push(
                `    • ${name} — "${label}" [${typeLabel}] | ${mandatory}` +
                  (flags ? ` | ${flags}` : '') +
                  ` | order: ${order}`,
              );
            }
            lines.push('');
          }
        }

        if (standalone.length > 0) {
          lines.push('### Create Standalone (create_catalog_variable)');
          for (const name of standalone) {
            // biome-ignore lint/style/noNonNullAssertion: standalone is a subset of plannedByName.keys()
            const pv = plannedByName.get(name)!;
            const typeLabel =
              VARIABLE_TYPE_MAP[pv.type] ?? `Unknown (${pv.type})`;
            lines.push(
              `  • ${name} — type: ${typeLabel} (${pv.type})` +
                (pv.mandatory ? ' | mandatory' : ''),
            );
          }
          lines.push('');
        }

        lines.push(
          'Ask the user: "Does this plan look correct? Should I proceed?"',
        );

        const reuseJson = selected.map((set) => ({
          sys_id: set.setId,
          name: set.setName,
          covers: set.covered,
          variables: set.rows.map((row) => {
            const typeCode = resolveValue(row.type);
            return {
              sys_id: resolveValue(row.sys_id),
              name: resolveDisplay(row.name),
              label:
                (row.label ? resolveDisplay(row.label) : '') ||
                (row.question_text ? resolveDisplay(row.question_text) : '') ||
                resolveDisplay(row.name),
              question_text: row.question_text
                ? resolveDisplay(row.question_text)
                : null,
              type_code: typeCode,
              type_label:
                VARIABLE_TYPE_MAP[typeCode] ?? `Unknown (${typeCode})`,
              order: parseInt(resolveDisplay(row.order) || '0', 10),
              mandatory: boolStr(row.mandatory),
              read_only: boolStr(row.read_only),
              hidden: boolStr(row.hidden),
              active: boolStr(row.active),
              default_value: resolveDisplay(row.default_value) || null,
              help_text: resolveDisplay(row.help_text) || null,
              reference_table: row.reference
                ? resolveDisplay(row.reference)
                : null,
              reference_qual: row.reference_qual
                ? resolveValue(row.reference_qual)
                : null,
              reference_qual_condition: row.reference_qual_condition
                ? resolveValue(row.reference_qual_condition)
                : null,
              use_reference_qualifier: row.use_reference_qualifier
                ? resolveDisplay(row.use_reference_qualifier)
                : null,
              max_length: row.max_length
                ? parseInt(resolveDisplay(row.max_length) || '0', 10)
                : null,
              lookup_table: row.lookup_table
                ? resolveDisplay(row.lookup_table)
                : null,
              list_table: row.list_table
                ? resolveDisplay(row.list_table)
                : null,
            };
          }),
        }));

        return {
          content: [
            { type: 'text' as const, text: lines.join('\n') },
            {
              type: 'text' as const,
              text:
                '\n\n---\nJSON:\n' +
                JSON.stringify({ reuse: reuseJson, standalone }, null, 2),
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
