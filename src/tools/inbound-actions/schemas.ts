import { z } from 'zod';

// ── Inbound Email Action (sysevent_in_email_action) ─────────────────────────
//
// An inbound email action runs server-side when ServiceNow receives an email.
// Processing model (spell this out for the caller):
//
//   1. The inbound email is CLASSIFIED as New, Reply, or Forward — by watermark
//      match / In-Reply-To headers. A watermarked reply to a notification is a
//      Reply; an unmatched message is New.
//   2. Only actions whose `type` matches the classification are considered.
//   3. Matching actions run in ascending `order` (lower first). `filter_condition`
//      (encoded query) and `condition_script` (JS boolean) gate each one.
//   4. `stop_processing=true` halts the chain — no lower-priority action runs.
//
// Inside `script` the runtime exposes: `current` (the target/matched GlideRecord —
// a NEW record of `table` for type=new, the watermarked record for reply/forward),
// `email` (EmailWrapper: email.subject, email.body_text, email.origemail,
// email.from, and custom `name: value` lines via email.body.<name>), `sys_email`
// (the inbound sys_email GlideRecord), `event`, `logger`, `classifier`, and `gs`.
//
// Field shapes verified against the sysevent_in_email_action dictionary on the PDI.

const InboundActionBase = z.object({
  name: z
    .string()
    .min(1)
    .describe('Name of the inbound email action, e.g. "Create Incident".'),
  type: z
    .enum(['new', 'reply', 'forward'])
    .describe(
      'Which class of inbound email this action handles — it runs ONLY for that ' +
        'classification:\n' +
        '• new — a fresh message with no watermark match (typically creates a record).\n' +
        '• reply — a watermarked reply to a notification (`current` is the matched record).\n' +
        '• forward — a forwarded message (`current` is the matched record).\n' +
        'Pick exactly one; never assume one action covers all three.',
    ),
  action: z
    .enum(['record_action', 'reply_email'])
    .describe(
      'What the action does:\n' +
        '• record_action — run `script` against `current` (create/update a record). The common case.\n' +
        '• reply_email — send the `reply_email` HTML body back to the sender instead.',
    ),
  table: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Target table internal name, e.g. 'incident' — NOT the label. For type=new " +
        'this is the table the new `current` record belongs to and is REQUIRED. ' +
        'For reply/forward the record is resolved from the watermark, so this is ' +
        'usually left empty. Use resolve_table if unsure.',
    ),
  active: z
    .boolean()
    .optional()
    .describe('Whether the action is active (eligible to run).'),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Processing order among same-type actions. Lower runs first. Default 100.',
    ),
  stop_processing: z
    .boolean()
    .optional()
    .describe(
      'When true, no lower-priority (higher-order) action of the same type runs ' +
        'after this one. Use to claim an email exclusively. Default false.',
    ),
  filter_condition: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'DEFAULT FIELD for gating on record field values. Encoded query against ' +
        "`table`, e.g. 'active=true^category=hardware'. For type=new it is matched " +
        'against the new record; for reply/forward against the matched record. ' +
        'Use this for field comparisons — never put them in condition_script.',
    ),
  condition_script: z
    .string()
    .max(254)
    .optional()
    .describe(
      'Server-side JavaScript boolean expression deciding whether the action runs. ' +
        'NOT an encoded query. Has access to `email`, `current`, and `gs`, e.g. ' +
        '"email.subject.indexOf(\'urgent\') >= 0". Only use this when the gate ' +
        'cannot be expressed as an encoded query (use filter_condition for those).',
    ),
  script: z
    .string()
    .max(8000)
    .optional()
    .describe(
      'Server-side JavaScript run when action=record_action. Has `current` (the ' +
        'target/matched GlideRecord), `email` (email.subject, email.body_text, ' +
        'email.origemail, email.body.<custom>), `sys_email`, `event`, `logger`, ' +
        '`classifier`, and `gs`. Call current.insert() for type=new or ' +
        'current.update() for reply/forward to persist changes.',
    ),
  reply_email: z
    .string()
    .max(65536)
    .optional()
    .describe(
      'HTML body sent back to the sender. Only used when action=reply_email.',
    ),
  from: z
    .string()
    .max(32)
    .optional()
    .describe(
      'Optional sender filter: sys_id of a sys_user. When set, the action only ' +
        'runs for emails from that user. Leave empty to match any sender. ' +
        '(Subject/keyword filters are not a field — express them in condition_script.)',
    ),
  required_roles: z
    .string()
    .optional()
    .describe(
      'Optional comma-separated sys_user_role sys_ids the sending user must hold ' +
        'for the action to run.',
    ),
  event_name: z
    .string()
    .max(40)
    .optional()
    .describe(
      'System event that triggers this action. Defaults to "email.read" — leave ' +
        'as the default unless you have a custom inbound email event.',
    ),
  description: z
    .string()
    .optional()
    .describe(
      'Free-text notes describing what the action does (not shown to users).',
    ),
});

/**
 * Every writable sysevent_in_email_action column, derived from the base schema so
 * the schema stays the single source of truth — the create/update handlers iterate
 * this to build the request body instead of re-listing field names. sys_id is
 * intentionally absent: it addresses the record, it is never written into it.
 */
export const INBOUND_ACTION_FIELDS = Object.keys(InboundActionBase.shape);

export const InboundActionCreate = InboundActionBase.extend({
  type: InboundActionBase.shape.type
    .default('new')
    .describe(
      'Which class of inbound email this action handles. Defaults to "new".',
    ),
  action: InboundActionBase.shape.action
    .default('record_action')
    .describe('What the action does. Defaults to "record_action".'),
  active: z.boolean().optional().default(true).describe('Defaults to true.'),
  order: z.number().int().optional().default(100).describe('Defaults to 100.'),
  stop_processing: z
    .boolean()
    .optional()
    .default(false)
    .describe('Defaults to false.'),
});

export const InboundActionUpdate = InboundActionBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_in_email_action record to update.'),
});

export const InboundActionList = z.object({
  table: z
    .string()
    .optional()
    .describe('Filter to actions targeting this table.'),
  type: z
    .enum(['new', 'reply', 'forward'])
    .optional()
    .describe('Filter by classification (new/reply/forward).'),
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

export const InboundActionGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_in_email_action record to read.'),
});
