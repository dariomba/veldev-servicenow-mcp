import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord, SnReference } from '../../types/servicenow.js';
import {
  disp,
  errText,
  handleError,
  recordUrl,
  requireSysId,
  resolveValue,
  richResult,
  serializeFields,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  UI_ACTION_FIELDS,
  UiActionCreate,
  UiActionGet,
  UiActionList,
  UiActionUpdate,
} from './schemas.js';

const TABLE = 'sys_ui_action';
const VIEW_TABLE = 'sys_ui_action_view';

// Single source of truth for placement: each flag paired with the label used
// in read output, grouped by surface. The placement warning (create/update),
// the workspace guardrail, and the get decode all derive from this — no field
// name is repeated elsewhere.
const PLACEMENT = {
  form: [
    ['form_button', 'button'],
    ['form_link', 'link'],
    ['form_context_menu', 'context menu'],
  ],
  list: [
    ['list_button', 'bottom button'],
    ['list_banner_button', 'banner button'],
    ['list_link', 'link'],
    ['list_context_menu', 'context menu'],
    ['list_choice', 'choice list'],
  ],
  workspace: [
    ['form_button_v2', 'form button'],
    ['form_menu_button_v2', 'form menu'],
  ],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;

// At least one placement flag must be set or the action appears nowhere.
const PLACEMENT_FIELDS = Object.values(PLACEMENT).flatMap((group) =>
  group.map(([field]) => field),
);

const WORKSPACE_AUTOENABLE_NOTE =
  'NOTE: format_for_configurable_workspace was auto-enabled because a ' +
  'workspace field was set.';

type UiActionInput = Record<string, unknown>;

/**
 * Workspace fields do nothing unless format_for_configurable_workspace is true.
 * Returns whether any workspace field was requested and whether the master
 * toggle had to be auto-enabled as a result.
 */
function resolveWorkspaceToggle(input: UiActionInput): {
  wantsWorkspace: boolean;
  autoEnabled: boolean;
  toggle: boolean | undefined;
} {
  const scriptV2 = input.client_script_v2;
  const wantsWorkspace =
    PLACEMENT.workspace.some(([field]) => input[field] === true) ||
    (typeof scriptV2 === 'string' && scriptV2.trim() !== '');

  let toggle = input.format_for_configurable_workspace as boolean | undefined;
  let autoEnabled = false;
  // Only force the toggle on when the caller left it unspecified — an explicit
  // false is the caller's choice and is respected.
  if (wantsWorkspace && toggle === undefined) {
    toggle = true;
    autoEnabled = true;
  }
  return { wantsWorkspace, autoEnabled, toggle };
}

/** Builds the Table API body from the supplied (already-defaulted) input. */
function buildBody(
  input: UiActionInput,
  toggle: boolean | undefined,
): UiActionInput {
  const body = serializeFields(input, UI_ACTION_FIELDS);
  // The toggle may have been forced on by the workspace guardrail.
  if (toggle !== undefined)
    body.format_for_configurable_workspace = String(toggle);
  return body;
}

function placementWarning(input: UiActionInput): string | null {
  const hasPlacement = PLACEMENT_FIELDS.some((f) => input[f] === true);
  return hasPlacement
    ? null
    : 'WARNING: no placement flag set (form_button, form_link, list_button, ' +
        'form_button_v2, …) — the action will not appear anywhere until one is set.';
}

export function registerUiActionTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'create_ui_action',
    {
      access: 'write',
      title: 'Create UI Action',
      description: [
        'Creates a sys_ui_action record — a button, link, or context-menu item',
        'on a ServiceNow form or list, optionally also in Configurable Workspace.',
        '',
        'TWO execution models on the same record, kept distinct:',
        '• CLASSIC (platform UI): server-side `script` (client=false), or a',
        '  client function named by `onclick` defined in `script` (client=true) —',
        '  full g_form / DOM API.',
        '• WORKSPACE (Agent Workspace): `client_script_v2` onClick(g_form) with the',
        '  reduced workspace API. Never paste a classic script into client_script_v2.',
        '',
        'GUARDRAIL: setting any workspace field (form_button_v2, form_menu_button_v2,',
        'client_script_v2) auto-enables format_for_configurable_workspace — without',
        'it the workspace button silently never appears.',
        '',
        'Set at least one placement flag (form_button, list_button, …) or the action',
        'appears nowhere. Idempotent: an existing action with the same name+table is',
        'returned unchanged.',
      ].join('\n'),
      inputSchema: UiActionCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { name, table } = input;
        const existing = await client.listRecords<{ sys_id: SnReference }>(
          TABLE,
          `name=${name}^table=${table}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return textResult(
            [
              'UI Action already exists — skipped.',
              '',
              `name:   ${name}`,
              `table:  ${table}`,
              `sys_id: ${resolveValue(existing[0].sys_id)}`,
            ].join('\n'),
          );
        }

        const { wantsWorkspace, autoEnabled, toggle } =
          resolveWorkspaceToggle(input);
        const body = buildBody(input, toggle);

        const record = await client.createRecord<SnRecord>(TABLE, body);
        const sys_id = val(record, 'sys_id');

        const lines = [
          'UI Action created.',
          '',
          `name:      ${name}`,
          `table:     ${table}`,
          `client:    ${input.client === true}`,
          `workspace: ${wantsWorkspace ? 'enabled' : 'no'}`,
          `order:     ${input.order ?? 100}`,
          `sys_id:    ${sys_id}`,
          `URL:       ${recordUrl(client, TABLE, sys_id)}`,
        ];
        if (autoEnabled) lines.push('', WORKSPACE_AUTOENABLE_NOTE);
        const warn = placementWarning(input);
        if (warn) lines.push('', warn);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_ui_action',
    {
      access: 'write',
      title: 'Update UI Action',
      description: [
        'Updates fields on an existing sys_ui_action record.',
        'Pass only the fields you want to change — omitted fields stay as-is.',
        '',
        'GUARDRAIL: setting a workspace field (form_button_v2, form_menu_button_v2,',
        'client_script_v2) auto-enables format_for_configurable_workspace unless you',
        'explicitly pass it as false.',
      ].join('\n'),
      inputSchema: UiActionUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const sys_id = input.sys_id as string;
        const idErr = requireSysId(sys_id, 'sys_ui_action sys_id');
        if (idErr) return errText(idErr);

        const { autoEnabled, toggle } = resolveWorkspaceToggle(input);
        const body = buildBody(input, toggle);

        if (Object.keys(body).length === 0) {
          return textResult('No fields to update — all values were omitted.');
        }

        await client.patchRecord<unknown>(TABLE, sys_id, body);

        const lines = [
          'UI Action updated successfully.',
          '',
          `sys_id:         ${sys_id}`,
          `Updated fields: ${Object.keys(body).join(', ')}`,
        ];
        if (autoEnabled) lines.push('', WORKSPACE_AUTOENABLE_NOTE);
        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_ui_actions',
    {
      access: 'read',
      title: 'List UI Actions',
      description: [
        'Lists sys_ui_action records, optionally filtered by table, name',
        'substring, or active flag. Ordered by table then order.',
      ].join('\n'),
      inputSchema: UiActionList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ table, name_contains, active, limit }) => {
      try {
        const clauses: string[] = [];
        if (table) clauses.push(`table=${table}`);
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        if (active !== undefined) clauses.push(`active=${String(active)}`);
        clauses.push('ORDERBYtable', 'ORDERBYorder');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'name',
            'table',
            'active',
            'order',
            'client',
            'form_button',
            'list_button',
            'format_for_configurable_workspace',
          ],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const flags: string[] = [];
                if (val(r, 'client') === 'true') flags.push('client');
                if (val(r, 'format_for_configurable_workspace') === 'true')
                  flags.push('workspace');
                const tag = flags.length ? ` [${flags.join(', ')}]` : '';
                const act = val(r, 'active') === 'true' ? '' : ' (inactive)';
                return (
                  `${disp(r, 'table')} — ${val(r, 'name')}${act} ` +
                  `— order ${val(r, 'order') || '100'}${tag} — ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No UI actions matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_ui_action',
    {
      access: 'read',
      title: 'Get UI Action',
      description: [
        'Reads a single sys_ui_action record: its classic placement / script,',
        'its Configurable Workspace configuration, and any per-view visibility',
        'restrictions (sys_ui_action_view, read-only here).',
      ].join('\n'),
      inputSchema: UiActionGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const idErr = requireSysId(sys_id, 'sys_ui_action sys_id');
        if (idErr) return errText(idErr);

        // Independent reads — the view query keys off the input sys_id.
        const [base, viewRows] = await Promise.all([
          client.getRecord<SnRecord>(TABLE, sys_id),
          client.listRecords<SnRecord>(
            VIEW_TABLE,
            `sys_ui_action=${sys_id}`,
            ['sys_id', 'sys_ui_view', 'visibility'],
            50,
          ),
        ]);

        const bool = (f: string) => val(base, f) === 'true';
        // Labels for the placement flags that are set on, derived from PLACEMENT.
        const placedLabels = (
          group: (typeof PLACEMENT)[keyof typeof PLACEMENT],
        ) => group.filter(([field]) => bool(field)).map(([, label]) => label);

        const formPlacement = placedLabels(PLACEMENT.form);
        const listPlacement = placedLabels(PLACEMENT.list);
        const workspacePlacement = placedLabels(PLACEMENT.workspace);

        const viewRestrictions = viewRows.map((v) => ({
          sys_id: val(v, 'sys_id'),
          view: disp(v, 'sys_ui_view'),
          visibility: val(v, 'visibility'),
        }));

        const result = {
          sys_id: val(base, 'sys_id'),
          name: val(base, 'name'),
          table: disp(base, 'table'),
          action_name: val(base, 'action_name'),
          active: bool('active'),
          order: val(base, 'order') || '100',
          condition: val(base, 'condition'),
          hint: val(base, 'hint'),
          comments: val(base, 'comments'),
          client: bool('client'),
          isolate_script: bool('isolate_script'),
          onclick: val(base, 'onclick'),
          script: val(base, 'script'),
          show: {
            insert: bool('show_insert'),
            update: bool('show_update'),
            multiple_update: bool('show_multiple_update'),
            query: bool('show_query'),
          },
          form_placement: formPlacement,
          list_placement: listPlacement,
          workspace: {
            enabled: bool('format_for_configurable_workspace'),
            placement: workspacePlacement,
            client_script_v2: val(base, 'client_script_v2'),
          },
          view_restrictions: viewRestrictions,
          url: recordUrl(client, TABLE, sys_id),
        };

        const summary = [
          `UI Action: ${result.name} (${result.sys_id})`,
          `Table:     ${result.table}${result.active ? '' : ' — INACTIVE'}`,
          `Condition: ${result.condition || '(always)'}`,
          `Order:     ${result.order} · client=${result.client} · action_name=${
            result.action_name || '—'
          }`,
          `Shows on:  ${
            Object.entries(result.show)
              .filter(([, on]) => on)
              .map(([k]) => k)
              .join(', ') || '(none)'
          }`,
          `Form:      ${result.form_placement.join(', ') || '(none)'}`,
          `List:      ${result.list_placement.join(', ') || '(none)'}`,
          `Workspace: ${
            result.workspace.enabled
              ? `enabled — ${
                  result.workspace.placement.join(', ') || 'no placement'
                }${result.workspace.client_script_v2 ? ' · has client_script_v2' : ''}`
              : 'disabled'
          }`,
          `Views:     ${
            viewRestrictions.length
              ? viewRestrictions
                  .map((v) => `${v.view} (${v.visibility})`)
                  .join(', ')
              : '(all views)'
          }`,
          `URL:       ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
