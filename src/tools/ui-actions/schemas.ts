import { z } from 'zod';

// ── UI Action (sys_ui_action) ───────────────────────────────────────────────
//
// A single sys_ui_action record models a button / link / context-menu item on a
// form or list, AND its Configurable-Workspace (Agent Workspace) equivalent —
// the workspace fields live on the SAME record as the classic ones. The two
// execution models are deliberately kept distinct in this schema so a caller
// can't accidentally cross the wires:
//
//   • CLASSIC (platform UI): `script` (server-side) and/or `onclick` + `client`
//     (client-side) with the full g_form / DOM / window API.
//   • WORKSPACE (configurable workspace): `client_script_v2` — an onClick(g_form)
//     function with the REDUCED workspace API (g_form, g_modal, GlideAjax; no
//     DOM, no window globals) — gated behind format_for_configurable_workspace.
//
// Field shapes verified against the sys_ui_action dictionary on the PDI.

const UiActionBase = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .describe(
      'Label shown on the button / link / menu item, e.g. "Resolve Incident".',
    ),
  table: z
    .string()
    .min(1)
    .describe(
      "Internal name of the table the action appears on, e.g. 'incident' — " +
        'NOT the label. Use resolve_table if unsure.',
    ),
  action_name: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Stable identifier for the action, used to invoke it from a client ' +
        "script via gsftSubmit('<action_name>') and to read it server-side via " +
        "current's action context. Optional but recommended when onclick calls " +
        'gsftSubmit. Letters/underscores only — no spaces.',
    ),
  condition: z
    .string()
    .max(254)
    .optional()
    .describe(
      'Server-side JavaScript boolean expression deciding whether the action ' +
        'is shown for the current record. NOT an encoded query. Has access to ' +
        '`current` and `gs`, e.g. "gs.hasRole(\'itil\')" or ' +
        '"current.active == true". Leave empty to always show.',
    ),
  active: z.boolean().optional().describe('Whether the action is active.'),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Display / execution order. Lower appears first (further left for ' +
        'buttons). Default 100.',
    ),
  hint: z
    .string()
    .max(254)
    .optional()
    .describe('Tooltip text shown when hovering the button / link.'),
  comments: z
    .string()
    .optional()
    .describe(
      'Free-text notes describing what the action does (not shown to users).',
    ),

  // ── Classic script model ─────────────────────────────────────────────────
  client: z
    .boolean()
    .optional()
    .describe(
      'Run the action client-side. When true, the click invokes the function ' +
        'named in `onclick`, defined in `script`. When false, `script` runs ' +
        'server-side on click. Required true for the classic onclick path.',
    ),
  onclick: z
    .string()
    .max(254)
    .optional()
    .describe(
      'CLASSIC client-side entry point: the name of the JS function (defined ' +
        'in `script`) to call when clicked, e.g. "validateThenSubmit()". Only ' +
        'used when client=true. This is the platform-UI onclick — NOT the ' +
        'workspace script (use client_script_v2 for workspace).',
    ),
  script: z
    .string()
    .max(8000)
    .optional()
    .describe(
      'CLASSIC script. When client=false this is the SERVER-side script run on ' +
        'click, with access to `current`, `gs`, `previous`, and `action` ' +
        '(e.g. action.setRedirectURL(url)); call current.update() to save. ' +
        'When client=true this holds the client-side function definitions that ' +
        '`onclick` calls, using the full g_form / window / DOM API; submit the ' +
        "form with gsftSubmit(null, g_form.getFormElement(), '<action_name>') " +
        'to also run the server script. This is the platform-UI script — NOT ' +
        'the workspace script (use client_script_v2).',
    ),
  isolate_script: z
    .boolean()
    .optional()
    .describe(
      'Run the classic client script in an isolated scope with no access to ' +
        'window / DOM globals. UI Actions often need globals, so this defaults ' +
        'to false; set true only when the script is self-contained.',
    ),
  messages: z
    .string()
    .optional()
    .describe(
      'Newline-separated messages to pre-register for getMessage() lookups on ' +
        'the client.',
    ),

  // ── Form placement (classic platform UI) ─────────────────────────────────
  form_button: z
    .boolean()
    .optional()
    .describe('Show as a button in the form header.'),
  form_button_icon: z
    .string()
    .max(40)
    .optional()
    .describe('Optional icon for the form button.'),
  form_link: z
    .boolean()
    .optional()
    .describe('Show as a link under the form (related links).'),
  form_context_menu: z
    .boolean()
    .optional()
    .describe('Show in the form right-click context menu.'),

  // ── List placement (classic platform UI) ─────────────────────────────────
  list_button: z
    .boolean()
    .optional()
    .describe('Show as a button at the bottom of the list.'),
  list_button_icon: z
    .string()
    .max(40)
    .optional()
    .describe('Optional icon for the list button.'),
  list_banner_button: z
    .boolean()
    .optional()
    .describe('Show as a button in the list title banner (top of the list).'),
  list_link: z
    .boolean()
    .optional()
    .describe('Show as a link at the bottom of the list.'),
  list_context_menu: z
    .boolean()
    .optional()
    .describe('Show in the list row right-click context menu.'),
  list_choice: z
    .boolean()
    .optional()
    .describe(
      'Show in the "Actions on selected rows" choice list (acts on checked rows).',
    ),

  // ── When the action is offered (classic) ─────────────────────────────────
  show_insert: z
    .boolean()
    .optional()
    .describe('Show on a new (not-yet-inserted) record. Default true.'),
  show_update: z
    .boolean()
    .optional()
    .describe('Show on an existing (already-inserted) record. Default true.'),
  show_multiple_update: z
    .boolean()
    .optional()
    .describe('Show on the multi-row list-edit screen.'),
  show_query: z
    .boolean()
    .optional()
    .describe('Show on a list query / filter context.'),

  // ── Configurable Workspace (Agent Workspace) ─────────────────────────────
  format_for_configurable_workspace: z
    .boolean()
    .optional()
    .describe(
      'MASTER TOGGLE for workspace. Must be true for ANY workspace flag below ' +
        '(form_button_v2, form_menu_button_v2, client_script_v2) to take ' +
        'effect — the #1 reason a workspace button never appears. This tool ' +
        'auto-enables it when you set a workspace field, but you can set it ' +
        'explicitly too.',
    ),
  form_button_v2: z
    .boolean()
    .optional()
    .describe(
      'Show as a button on the Configurable Workspace form. Requires ' +
        'format_for_configurable_workspace=true (auto-enabled).',
    ),
  form_menu_button_v2: z
    .boolean()
    .optional()
    .describe(
      'Show in the Configurable Workspace form menu (the "..." overflow). ' +
        'Requires format_for_configurable_workspace=true (auto-enabled).',
    ),
  client_script_v2: z
    .string()
    .max(8000)
    .optional()
    .describe(
      'WORKSPACE client script — an onClick(g_form) function run in ' +
        'Configurable Workspace. Uses the REDUCED workspace client API ' +
        '(g_form, g_modal, GlideAjax) with NO DOM and NO window globals — do ' +
        'NOT paste a classic onclick/script body here, it will fail. Requires ' +
        'format_for_configurable_workspace=true (auto-enabled). Separate from ' +
        'the classic `script` / `onclick`.',
    ),
});

/**
 * Every writable sys_ui_action column, derived from the base schema so the
 * schema stays the single source of truth — the create/update handlers iterate
 * this to build the request body instead of re-listing field names. sys_id is
 * intentionally absent: it addresses the record, it is never written into it.
 */
export const UI_ACTION_FIELDS = Object.keys(UiActionBase.shape);

export const UiActionCreate = UiActionBase.extend({
  active: z.boolean().optional().default(true).describe('Defaults to true.'),
  order: z.number().int().optional().default(100).describe('Defaults to 100.'),
  client: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Run the action client-side (invokes onclick). Defaults to false ' +
        '(server-side script on click).',
    ),
  isolate_script: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Isolate the classic client script from window / DOM globals. Defaults ' +
        'to false (UI Actions commonly need globals).',
    ),
  // No default: an unspecified toggle is what lets the guardrail auto-enable
  // it when a workspace field is set, while an explicit false is respected.
});

export const UiActionUpdate = UiActionBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_ui_action record to update.'),
});

export const UiActionList = z.object({
  table: z.string().optional().describe('Filter to actions on this table.'),
  name_contains: z
    .string()
    .optional()
    .describe('Filter to actions whose name contains this text.'),
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
    .describe('Maximum number of actions to return (1–100). Defaults to 50.'),
});

export const UiActionGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_ui_action record to read.'),
});
