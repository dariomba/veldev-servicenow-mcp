import { z } from 'zod';

// ── Event Registration (sysevent_register) ─────────────────────────────

const EventRegistrationBase = z.object({
  event_name: z
    .string()
    .min(1)
    .max(40)
    .describe(
      'Name of the event, used in gs.eventQueue() and by script actions. ' +
        "ServiceNow convention is '<table>.<verb>', e.g. 'incident.commented' or " +
        "'x_acme_app.approved'. The table prefix is NOT added automatically — include it. " +
        'Lowercase, dot-separated, no spaces.',
    ),
  table: z
    .string()
    .optional()
    .describe(
      "Internal name of the table this event relates to, e.g. 'incident' — NOT the label. " +
        'Documentation only; it does not restrict where the event can be fired from.',
    ),
  queue: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Name of the processing queue that handles this event. Omit to use the ' +
        "built-in 'DEFAULT' queue. To route to a custom queue, pass that queue's " +
        'name (the `queue` value of a sysevent_queue record created via create_event_queue).',
    ),
  description: z
    .string()
    .max(100)
    .optional()
    .describe('What the event represents / when it fires.'),
  fired_by: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Free-text note documenting what fires this event (e.g. a business rule name). ' +
        'Documentation only.',
    ),
  priority: z
    .number()
    .int()
    .optional()
    .describe(
      'Processing priority; lower runs first. Defaults to 100. Leave default unless ' +
        'this event must be processed ahead of others in the same queue.',
    ),
  suffix: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Optional suffix used by some platform features; usually left empty.',
    ),
  caller_access: z
    .enum(['tracking', 'restriction'])
    .optional()
    .describe(
      'Caller access mode. Usually omitted. ' +
        "'tracking' = Caller Tracking, 'restriction' = Caller Restriction.",
    ),
});

export const EventRegistrationCreate = EventRegistrationBase;

export const EventRegistrationUpdate = EventRegistrationBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_register record to update.'),
});

export const EventList = z.object({
  name_contains: z
    .string()
    .optional()
    .describe('Filter to events whose event_name contains this substring.'),
  table: z
    .string()
    .optional()
    .describe(
      "Filter to events registered against this table, e.g. 'incident'.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of events to return (1–100). Defaults to 50.'),
});

export const EventGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_register record to read.'),
});

// ── Event Queue (sysevent_queue) ───────────────────────────────────────

const QUEUE_NAME = z
  .string()
  .min(1)
  .max(40)
  .regex(
    /^[a-z0-9_]+$/,
    'Queue name must use only lowercase letters, digits, and underscores (no spaces or other characters).',
  );

const EventQueueBase = z.object({
  queue: QUEUE_NAME.describe(
    'Unique queue name. Lowercase letters, digits and underscores only — no spaces. ' +
      'Event registrations route to this queue by referencing this name in their `queue` field.',
  ),
  description: z
    .string()
    .max(255)
    .optional()
    .describe('What this queue is for / which events it handles.'),
  processing_order: z
    .enum(['parallel', 'sequential'])
    .optional()
    .describe(
      "'parallel' (default) processes events concurrently across jobs; " +
        "'sequential' processes one event at a time in order. Use 'sequential' only " +
        'when event ordering matters.',
    ),
  job_config: z
    .enum(['jobs_per_node', 'job_count'])
    .optional()
    .describe(
      'How processing jobs are scaled. ' +
        "'jobs_per_node' (default) = create job_config_value jobs per node (scales with cluster); " +
        "'job_count' = a constant total of job_config_value jobs.",
    ),
  job_config_value: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Number of processing jobs (interpreted per job_config). Defaults to 1. ' +
        'Raise for high-volume queues.',
    ),
  poll_interval_seconds: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'How often (seconds) the queue polls for new events. Defaults to 30. ' +
        'Lower means lower latency but more overhead.',
    ),
  automatic_processing: z
    .boolean()
    .optional()
    .describe(
      'Let ServiceNow create and schedule the processing jobs automatically. ' +
        'Defaults to true — keep true unless you manage the jobs yourself.',
    ),
  suffix: z
    .string()
    .max(40)
    .optional()
    .describe('Optional suffix; usually left empty.'),
});

export const EventQueueCreate = EventQueueBase;

export const EventQueueUpdate = z
  .object({
    sys_id: z
      .string()
      .min(1)
      .describe('sys_id of the sysevent_queue record to update.'),
    queue: QUEUE_NAME.optional().describe(
      'Renamed queue name (rarely changed).',
    ),
  })
  .merge(EventQueueBase.omit({ queue: true }).partial());

export const EventQueueList = z.object({
  name_contains: z
    .string()
    .optional()
    .describe('Filter to queues whose name contains this substring.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of queues to return (1–100). Defaults to 50.'),
});

// ── Script Action (sysevent_script_action) ─────────────────────────────

const ScriptActionBase = z.object({
  name: z.string().min(1).describe('Display name of the script action.'),
  event_name: z
    .string()
    .min(1)
    .max(40)
    .describe(
      'Name of the registered event this action responds to (must match a ' +
        "sysevent_register event_name, e.g. 'incident.commented'). The action runs " +
        'each time that event is processed.',
    ),
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript that runs when the event fires. The fired event is ' +
        'available as the global `event` (event.parm1, event.parm2, event.instance = the ' +
        'triggering record sys_id), and the related GlideRecord as `current` when the ' +
        'event was fired with one. Put ALL conditional logic here — see condition_script.',
    ),
  condition_script: z
    .string()
    .max(254)
    .optional()
    .describe(
      'Optional one-line condition. IMPORTANT: `event` and `current` are NOT in scope ' +
        'here, so this cannot test the triggering record — gate that logic inside `script` ' +
        'instead. Leave empty in most cases.',
    ),
  order: z
    .number()
    .int()
    .optional()
    .describe(
      'Execution order among script actions on the same event; lower runs first. Defaults to 100.',
    ),
  synchronous: z
    .boolean()
    .optional()
    .describe(
      'Run inline in the event-processing thread (true) instead of asynchronously (false, default). ' +
        'Keep false unless ordering against other synchronous handlers is required.',
    ),
  active: z
    .boolean()
    .optional()
    .describe('Whether the script action is active.'),
  description: z
    .string()
    .optional()
    .describe('Optional description of what the script action does.'),
});

export const ScriptActionCreate = ScriptActionBase.extend({
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the script action is active. Defaults to true.'),
  synchronous: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Run inline (true) instead of asynchronously (false). Defaults to false.',
    ),
});

export const ScriptActionUpdate = ScriptActionBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysevent_script_action record to update.'),
});

export const ScriptActionList = z.object({
  event_name: z
    .string()
    .optional()
    .describe('Filter to script actions listening on this exact event name.'),
  name_contains: z
    .string()
    .optional()
    .describe('Filter to script actions whose name contains this substring.'),
  active_only: z
    .boolean()
    .optional()
    .default(false)
    .describe('Return only active script actions. Defaults to false.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe(
      'Maximum number of script actions to return (1–100). Defaults to 50.',
    ),
});

// ── Fire Event (runtime, gs.eventQueue) ────────────────────────────────

export const FireEvent = z.object({
  event_name: z
    .string()
    .min(1)
    .describe(
      'Name of the event to fire (should match a registered sysevent_register event so ' +
        'script actions / notifications listen for it). Fires via gs.eventQueue().',
    ),
  record_table: z
    .string()
    .optional()
    .describe(
      "Internal table of a record to attach to the event, e.g. 'incident'. " +
        'Required together with record_sys_id to make `current` available to listeners.',
    ),
  record_sys_id: z
    .string()
    .optional()
    .describe(
      'sys_id of the record to attach. The event is fired with this record as its ' +
        'GlideRecord. Required together with record_table.',
    ),
  parm1: z
    .string()
    .optional()
    .describe(
      'Optional first parameter, readable as event.parm1 by listeners.',
    ),
  parm2: z
    .string()
    .optional()
    .describe(
      'Optional second parameter, readable as event.parm2 by listeners.',
    ),
});
