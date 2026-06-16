import { z } from 'zod';

// ── Email Notification (sysevent_email_action) ──────────────────────────────
//
// An email notification is an OUTBOUND mail rule: when something happens to a
// record, ServiceNow composes and sends an email. It is the counterpart to an
// inbound email action (mail in → inbound action; mail out → notification).
//
// WHEN it sends — driven by `generation_type` ("Send when"):
//   • engine  — "Record inserted or updated": fires on DB writes to `collection`
//               gated by `action_insert` / `action_update` and `condition`
//               (an encoded query) / `advanced_condition` (server-side JS).
//   • event   — "Event is fired": fires when the named system `event_name` is
//               pushed to the event queue (e.g. by a business rule via
//               gs.eventQueue). `collection` is the event's table.
//   • triggered — sent explicitly from Flow Designer / sn_notification scripts.
//
// WHO receives it — recipients are the UNION of every source set:
//   recipient_users, recipient_groups, recipient_fields (user/group fields ON
//   the record), send_self ("send to event creator"), and event parm 1/2 when
//   those flags say the parm carries a recipient. exclude_delegates trims
//   delegates from the resolved list.
//
// WHAT it sends — `subject` + `message_html` (the body). Both resolve
//   `${field}` and `${mail_script:<name>}` substitutions at send time;
//   `${mail_script:<name>}` embeds the output of a sys_script_email record
//   (see EmailScript schemas below). `content_type` picks HTML/plain/both;
//   `template` points at an Email Template (sysevent_email_template).
//
// DELIVERY knobs — `weight` de-dupes notifications that fire together for the
//   same record+recipient (see field doc); `importance`, `from`, `reply_to`,
//   `mandatory`, `category`. Outbound notifications stamp a WATERMARK so
//   recipient replies thread back to the source record via inbound actions;
//   `omit_watermark` suppresses it.
//
// Field shapes verified against the sysevent_email_action dictionary on the PDI.

export const CONTENT_TYPES = [
  'text/html',
  'multipart/mixed',
  'text/plain',
  'text/xml',
] as const;

export const GENERATION_TYPES = ['engine', 'event', 'triggered'] as const;

const NotificationBase = z.object({
  name: z
    .string()
    .min(1)
    .describe('Name of the notification, e.g. "Incident assigned to me".'),
  collection: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Internal table name the notification is for, e.g. 'incident' — NOT the " +
        'label. REQUIRED when generation_type=engine (the table whose inserts/' +
        'updates are watched and that `condition` queries). For event-based ' +
        "notifications it is the event's table. Use resolve_table if unsure.",
    ),
  active: z
    .boolean()
    .optional()
    .describe('Whether the notification is active (eligible to send).'),
  description: z
    .string()
    .optional()
    .describe('Free-text notes describing the notification (internal only).'),

  // ── WHEN to send ──────────────────────────────────────────────────────────
  generation_type: z
    .enum(GENERATION_TYPES)
    .optional()
    .describe(
      'How the notification is triggered ("Send when"):\n' +
        '• engine — Record inserted or updated: fires on DB writes to `collection`, gated by action_insert/action_update + condition.\n' +
        '• event — Event is fired: fires when system `event_name` is pushed to the event queue.\n' +
        '• triggered — sent explicitly from Flow Designer / notification scripts.\n' +
        'Default engine.',
    ),
  action_insert: z
    .boolean()
    .optional()
    .describe(
      'When generation_type=engine, fire on record INSERT. Ignored for event/triggered.',
    ),
  action_update: z
    .boolean()
    .optional()
    .describe(
      'When generation_type=engine, fire on record UPDATE. Ignored for event/triggered.',
    ),
  condition: z
    .string()
    .max(8000)
    .optional()
    .describe(
      'DEFAULT FIELD for gating on record field values. Encoded query against ' +
        "`collection`, e.g. 'priority=1^active=true'. Use VALCHANGES / CHANGESTO " +
        'for change-based gating. NEVER put field comparisons in ' +
        'advanced_condition — put them here.',
    ),
  advanced_condition: z
    .string()
    .max(8000)
    .optional()
    .describe(
      'Server-side JavaScript boolean expression — only for logic that CANNOT be ' +
        'expressed as an encoded query (e.g. gs.* calls). NOT an encoded query. ' +
        'Has access to `current`, `event`, and `gs`. Use `condition` for plain ' +
        'field comparisons.',
    ),
  event_name: z
    .string()
    .max(40)
    .optional()
    .describe(
      'System event that triggers this notification when generation_type=event, ' +
        "e.g. 'incident.assigned'. The event must be registered (sysevent_register) " +
        'and pushed via gs.eventQueue(...). Ignored when generation_type=engine.',
    ),

  // ── WHO receives it (union of all sources) ─────────────────────────────────
  recipient_users: z
    .string()
    .optional()
    .describe(
      'Comma-separated sys_user sys_ids to always send to (the "Users" list).',
    ),
  recipient_groups: z
    .string()
    .optional()
    .describe(
      'Comma-separated sys_user_group sys_ids whose members receive it (the "Groups" list).',
    ),
  recipient_fields: z
    .string()
    .optional()
    .describe(
      'Comma-separated FIELD NAMES on `collection` that hold a user or group ' +
        "(e.g. 'assigned_to,caller_id') — their value at send time becomes a " +
        'recipient. This is the "Users/Groups in fields" field.',
    ),
  send_self: z
    .boolean()
    .optional()
    .describe(
      'Send to the event creator / the user who triggered the record change ' +
        '("Send to event creator"). Defaults to true in ServiceNow.',
    ),
  event_parm_1: z
    .boolean()
    .optional()
    .describe(
      'Treat event parm1 as a recipient (sys_id passed as the 2nd arg of ' +
        'gs.eventQueue). Only meaningful for event-based notifications.',
    ),
  event_parm_2: z
    .boolean()
    .optional()
    .describe(
      'Treat event parm2 as a recipient (3rd arg of gs.eventQueue). ' +
        'Only meaningful for event-based notifications.',
    ),
  exclude_delegates: z
    .boolean()
    .optional()
    .describe('Exclude delegates of the resolved recipients from delivery.'),
  subscribable: z
    .boolean()
    .optional()
    .describe(
      'Allow users to subscribe to this notification (adds subscription-based recipients).',
    ),

  // ── WHAT it sends ───────────────────────────────────────────────────────────
  subject: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Email subject line. Supports ${field} and ${mail_script:<name>} substitutions.',
    ),
  message_html: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'The notification BODY (HTML). Resolves ${field} substitutions (dot-walk ' +
        'allowed, e.g. ${caller_id.name}) and ${mail_script:<name>} — which embeds ' +
        'the output of the sys_script_email record named <name> (create one with ' +
        'create_email_script). Use this as the primary content field.',
    ),
  content_type: z
    .enum(CONTENT_TYPES)
    .optional()
    .describe(
      'Body format: text/html (default), multipart/mixed (HTML + plain text), ' +
        'text/plain, or text/xml.',
    ),
  template: z
    .string()
    .max(32)
    .optional()
    .describe(
      'Optional sys_id of an Email Template (sysevent_email_template) supplying ' +
        'subject/body. Leave empty to use the inline subject/message_html.',
    ),

  // ── DELIVERY knobs ───────────────────────────────────────────────────────────
  weight: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'De-duplicates notifications that fire together for the SAME record and ' +
        'recipient. Among those with a NON-ZERO weight, only the highest sends ' +
        '(ties at the top all send). Weight 0 (default) ALWAYS sends, regardless ' +
        'of others. Raise the weight of the more specific notification to suppress ' +
        'a generic one.',
    ),
  importance: z
    .enum(['high', 'low'])
    .optional()
    .describe(
      'Optional email priority header: high or low. Omit for normal importance.',
    ),
  from: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Optional From address override. Leave empty for the instance default.',
    ),
  reply_to: z
    .string()
    .max(100)
    .optional()
    .describe('Optional Reply-To address override.'),
  mandatory: z
    .boolean()
    .optional()
    .describe(
      'Mark as mandatory — recipients cannot unsubscribe and it ignores ' +
        'notification preferences. Use sparingly.',
    ),
  category: z
    .string()
    .max(32)
    .optional()
    .describe(
      'Optional sys_id of a Notification Category (sys_notification_category). ' +
        'Omit to let ServiceNow apply the default category.',
    ),
  digestable: z
    .boolean()
    .optional()
    .describe('Allow this notification to be included in digest emails.'),
  omit_watermark: z
    .boolean()
    .optional()
    .describe(
      'Suppress the outbound WATERMARK. By default notifications stamp a ' +
        'watermark so recipient replies thread back to the source record via ' +
        'inbound email actions; set true to send an unwatermarked email.',
    ),
});

/**
 * Every writable sysevent_email_action column this tool exposes, derived from
 * the base schema so the schema stays the single source of truth — the
 * create/update handlers iterate this (via serializeFields) to build the
 * request body instead of re-listing field names. sys_id is intentionally
 * absent: it addresses the record, it is never written into it.
 */
export const NOTIFICATION_FIELDS = Object.keys(NotificationBase.shape);

export const NotificationCreate = NotificationBase.extend({
  active: z.boolean().optional().default(true).describe('Defaults to true.'),
  generation_type: NotificationBase.shape.generation_type
    .unwrap()
    .default('engine')
    .describe(
      'How the notification is triggered. Defaults to engine (Record inserted or updated).',
    ),
  action_insert: z
    .boolean()
    .optional()
    .default(false)
    .describe('Fire on record insert (engine only). Defaults to false.'),
  action_update: z
    .boolean()
    .optional()
    .default(false)
    .describe('Fire on record update (engine only). Defaults to false.'),
  send_self: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Send to the event creator. Defaults to true (matches ServiceNow).',
    ),
  content_type: NotificationBase.shape.content_type
    .unwrap()
    .default('text/html')
    .describe('Body format. Defaults to text/html.'),
});

export const NotificationUpdate = NotificationBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_email_action record to update.'),
});

export const NotificationList = z.object({
  collection: z
    .string()
    .optional()
    .describe('Filter to notifications for this table (internal name).'),
  generation_type: z
    .enum(GENERATION_TYPES)
    .optional()
    .describe('Filter by trigger type (engine/event/triggered).'),
  name_contains: z
    .string()
    .optional()
    .describe('Filter to notifications whose name contains this text.'),
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
    .describe(
      'Maximum number of notifications to return (1–100). Defaults to 50.',
    ),
});

export const NotificationGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_email_action record to read.'),
});

// ── Email Script (sys_script_email) ─────────────────────────────────────────
//
// A reusable mail script. It exists ONLY to be embedded in a notification or
// email-template body via ${mail_script:<name>} — at send time ServiceNow runs
// the script and splices its printed output into the email where the token sits.
//
// The script body is the standard wrapper:
//   (function runMailScript(current, template, email, email_action, event) { ... })
//       (current, template, email, email_action, event);
// In scope (verified against OOB scripts on the PDI):
//   • current      — GlideRecord being notified about (the target record).
//   • template     — TemplatePrinter; WRITE OUTPUT with template.print('<html>').
//   • email        — outbound EmailOutbound; e.g. email.addAddress('bcc', addr, name).
//   • email_action — the sysevent_email_action GlideRecord sending the mail.
//   • event        — the triggering event GlideRecord (event.parm1 / event.parm2).
//   • gs           — GlideSystem (globally available).
// Output is produced by template.print(...), NOT by returning a value.

const EmailScriptBase = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe(
      'Unique name of the mail script. Reference it from a notification/template ' +
        'body as ${mail_script:<name>}. Conventionally lower_snake_case.',
    ),
  script: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'Server-side JavaScript wrapped as ' +
        '"(function runMailScript(current, template, email, email_action, event){ ... })' +
        '(current, template, email, email_action, event);". Write into the email ' +
        "with template.print('<html>...') — the script's RETURN VALUE is ignored. " +
        'In scope: current (target GlideRecord), template (TemplatePrinter), email ' +
        '(EmailOutbound), email_action, event (event.parm1/parm2), and gs.',
    ),
  new_lines_to_html: z
    .boolean()
    .optional()
    .describe(
      'Convert newline characters in printed output to <br/> tags. Defaults to false.',
    ),
});

export const EMAIL_SCRIPT_FIELDS = Object.keys(EmailScriptBase.shape);

export const EmailScriptCreate = EmailScriptBase.extend({
  new_lines_to_html: z
    .boolean()
    .optional()
    .default(false)
    .describe('Convert newlines to <br/> tags. Defaults to false.'),
});

export const EmailScriptUpdate = EmailScriptBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_email record to update.'),
});

export const EmailScriptList = z.object({
  name_contains: z
    .string()
    .optional()
    .describe('Filter to email scripts whose name contains this text.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe(
      'Maximum number of email scripts to return (1–100). Defaults to 50.',
    ),
});

export const EmailScriptGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_email record to read.'),
});
