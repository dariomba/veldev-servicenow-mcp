import { z } from 'zod';

// ── Fix Script ────────────────────────────────────────────────────────────────

const FixScriptBase = z.object({
  name: z.string().min(1).describe('Display name of the fix script.'),
  description: z
    .string()
    .optional()
    .describe('Description of what the fix script does.'),
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript to execute. Runs in the global scope with full access to ' +
        'GlideRecord, gs, and all server-side APIs. ' +
        'Do NOT call current.update() — fix scripts run outside of a record context.',
    ),
  record_for_rollback: z
    .boolean()
    .optional()
    .describe(
      'When true, a rollback record is created so the fix script can be reverted if needed.',
    ),
  before: z
    .boolean()
    .optional()
    .describe(
      'When true, the fix script runs before the upgrade data migration. ' +
        'Defaults to false (runs after the upgrade).',
    ),
  unloadable: z
    .boolean()
    .optional()
    .describe('When true, the fix script can be unloaded from the instance.'),
});

export const FixScriptCreate = FixScriptBase.extend({
  record_for_rollback: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true, a rollback record is created so the fix script can be reverted. Defaults to true.',
    ),
  before: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, the fix script runs before the upgrade data migration. Defaults to false.',
    ),
  unloadable: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, the fix script can be unloaded from the instance. Defaults to false.',
    ),
});

export const FixScriptUpdate = FixScriptBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_fix record to update.'),
});

export const FixScriptRun = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sys_script_fix record to execute.'),
});

// ── Background Script ─────────────────────────────────────────────────────────

export const BackgroundScriptExecute = z.object({
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript to execute as a background script. ' +
        'Uses GlideRecord, gs, and other server-side APIs. ' +
        'The script runs in the global scope — no function wrapper needed.',
    ),
});

export const SCHEDULED_JOB_RUN_TYPES = [
  'daily',
  'weekly',
  'monthly',
  'week_in_month',
  'day_and_month_in_year',
  'day_week_month_year',
  'periodically',
  'once',
  'business_calendar_start',
  'business_calendar_end',
  'on_demand',
] as const;

const ScheduledJobBase = z.object({
  name: z
    .string()
    .min(1)
    .describe('Display name of the scheduled job. Used for idempotency.'),
  active: z.boolean().optional().describe('Whether the job is active.'),
  run_type: z
    .enum(SCHEDULED_JOB_RUN_TYPES)
    .optional()
    .describe(
      'How often the job runs, and which timing fields apply:\n' +
        '- daily: run_time\n' +
        '- weekly: run_time + run_dayofweek (one day) or run_daysofweek (several days)\n' +
        '- monthly: run_time + run_dayofmonth\n' +
        '- week_in_month: run_time + run_weekinmonth + run_dayofweek (e.g. 2nd Wednesday each month)\n' +
        '- day_and_month_in_year: run_time + run_month + run_dayofmonth (e.g. June 15 yearly)\n' +
        '- day_week_month_year: run_time + run_month + run_weekinmonth + run_dayofweek (e.g. 2nd Wednesday of June yearly)\n' +
        '- periodically: run_start + one or more period_* fields (the repeat interval)\n' +
        '- once: run_start (the single date/time it runs)\n' +
        '- business_calendar_start / business_calendar_end: business_calendar + offset_* + offset_type (fire relative to each calendar entry start/end)\n' +
        '- on_demand: never auto-runs; only via run_scheduled_job or another job.',
    ),
  run_time: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}$/, 'Expected time as "HH:MM:SS".')
    .optional()
    .describe(
      'Time of day the job fires, as "HH:MM:SS" (24-hour). Used by every ' +
        'time-of-day run_type (daily, weekly, monthly, week_in_month, ' +
        'day_and_month_in_year, day_week_month_year). Interpreted in `time_zone` ' +
        'when that is set (recommended — handles daylight saving for recurring ' +
        "jobs); otherwise in the instance's system time zone.",
    ),
  time_zone: z
    .string()
    .optional()
    .describe(
      "Time zone in which run_time is evaluated, written to the job's " +
        '"Run as tz" field — e.g. "US/Eastern", "America/New_York", "Europe/Madrid", ' +
        '"GMT". ServiceNow fires the job at run_time wall-clock in this zone and ' +
        'handles daylight saving automatically. Omit to use the instance default. ' +
        'Does not affect run_start, which is always an absolute UTC date/time.',
    ),
  run_dayofweek: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe(
      'Single day of week for run_type=weekly. 1=Monday … 7=Sunday. ' +
        'For more than one day per week use run_daysofweek instead.',
    ),
  run_daysofweek: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .optional()
    .describe(
      'Multiple days of week for run_type=weekly — the job fires on every listed ' +
        'day. 1=Monday … 7=Sunday, e.g. [2,3] = Tuesday and Wednesday. Maps to the ' +
        'sysauto "Days of Week" field and switches the trigger to "Days in Week" ' +
        'mode. Use this instead of run_dayofweek when the report must go out on ' +
        'several days each week. Takes precedence over run_dayofweek if both are set.',
    ),
  run_dayofmonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe(
      'Day of month (1–31). Used by run_type monthly and day_and_month_in_year.',
    ),
  run_weekinmonth: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe(
      'Which occurrence of the weekday within the month, for run_type ' +
        'week_in_month and day_week_month_year. 1=First … 5=Fifth, 6=Sixth.',
    ),
  run_month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      'Month of year (1=January … 12=December), for run_type ' +
        'day_and_month_in_year and day_week_month_year.',
    ),
  period_days: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('run_type=periodically: days component of the repeat interval.'),
  period_hours: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('run_type=periodically: hours component of the repeat interval.'),
  period_minutes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'run_type=periodically: minutes component of the repeat interval.',
    ),
  period_seconds: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'run_type=periodically: seconds component of the repeat interval.',
    ),
  run_start: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'Expected UTC date/time as "YYYY-MM-DD HH:MM:SS".',
    )
    .optional()
    .describe(
      'Start date/time as UTC "YYYY-MM-DD HH:MM:SS". Required for run_type=once ' +
        '(the moment it runs) and run_type=periodically (anchors the repeat). ' +
        'Stored as-is in UTC — the Table API does not convert it.',
    ),
  run_end: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'Expected UTC date/time as "YYYY-MM-DD HH:MM:SS".',
    )
    .optional()
    .describe(
      'Optional end date/time as UTC "YYYY-MM-DD HH:MM:SS". After this instant ' +
        'the recurring job stops firing. Omit for a schedule with no end. ' +
        'Stored as-is in UTC.',
    ),
  business_calendar: z
    .string()
    .optional()
    .describe(
      'sys_id of a business_calendar record. Required for run_type ' +
        'business_calendar_start / business_calendar_end — the job fires relative ' +
        "to each of that calendar's entry start/end times.",
    ),
  offset_type: z
    .enum(['future', 'past'])
    .optional()
    .describe(
      'Business-calendar run types only: whether the offset_* duration is applied ' +
        "after ('future') or before ('past') each calendar entry. Defaults to 'future'.",
    ),
  offset_days: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: days component of the offset.'),
  offset_hours: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: hours component of the offset.'),
  offset_minutes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: minutes component of the offset.'),
  offset_seconds: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Business-calendar run types: seconds component of the offset.'),
  conditional: z
    .boolean()
    .optional()
    .describe('When true, the job only runs if `condition` evaluates truthy.'),
  condition: z
    .string()
    .optional()
    .describe(
      'Server-side JavaScript condition evaluated before each run. ' +
        "Only used when conditional=true, e.g. \"gs.getProperty('my.flag') == 'true'\".",
    ),
  run_as: z
    .string()
    .optional()
    .describe(
      'sys_id of the sys_user to run the job as. Defaults to the job creator.',
    ),
});

// — Scheduled Script Execution (sysauto_script) —

const ScheduledScriptBase = ScheduledJobBase.extend({
  script: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Server-side JavaScript executed on schedule. Runs in the global scope ' +
        'with full access to GlideRecord, gs, and server-side APIs.',
    ),
});

export const ScheduledScriptCreate = ScheduledScriptBase.extend({
  script: z
    .string()
    .min(1)
    .describe(
      'Server-side JavaScript executed on schedule. Runs in the global scope ' +
        'with full access to GlideRecord, gs, and server-side APIs.',
    ),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the job is active. Defaults to true.'),
  run_type: z
    .enum(SCHEDULED_JOB_RUN_TYPES)
    .optional()
    .default('daily')
    .describe('How often the job runs. Defaults to daily.'),
});

export const ScheduledScriptUpdate = ScheduledScriptBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysauto_script record to update.'),
});

// — Scheduled Email of Report (sysauto_report) —

export const SCHEDULED_REPORT_OUTPUT_TYPES = [
  'PDF',
  'PDF-landscape',
  'PDF-autoresize',
  'XLSX',
  'Excel',
  'CSV',
  'PNG',
  'embedded_PNG',
] as const;

const ScheduledReportBase = ScheduledJobBase.extend({
  report: z
    .string()
    .optional()
    .describe(
      'sys_id of the report (sys_report) to email. Query sys_report by title to look it up.',
    ),
  report_title: z
    .string()
    .optional()
    .describe('Email subject line ("Subject" on the form).'),
  report_body: z
    .string()
    .optional()
    .describe('Introductory message body (HTML allowed).'),
  user_list: z
    .string()
    .optional()
    .describe('Recipient users as a comma-separated list of sys_user sys_ids.'),
  group_list: z
    .string()
    .optional()
    .describe(
      'Recipient groups as a comma-separated list of sys_user_group sys_ids.',
    ),
  address_list: z
    .string()
    .optional()
    .describe('Extra recipients as a comma-separated list of email addresses.'),
  output_type: z
    .enum(SCHEDULED_REPORT_OUTPUT_TYPES)
    .optional()
    .describe('Format of the attached report.'),
  include_detail: z
    .boolean()
    .optional()
    .describe('Include the underlying record detail, not just the chart.'),
  zip: z.boolean().optional().describe('Compress the attachment into a .zip.'),
  omit_if_no_records: z
    .boolean()
    .optional()
    .describe('Skip sending the email when the report has no records.'),
  page_size: z
    .enum(['A3', 'A4', 'Letter', 'Legal', 'Custom'])
    .optional()
    .describe(
      'Page size for PDF output types. Use "Custom" together with ' +
        'page_height_in_pixels and page_width_in_pixels.',
    ),
  page_height_in_pixels: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Page height in pixels. Only used when page_size="Custom".'),
  page_width_in_pixels: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Page width in pixels. Only used when page_size="Custom".'),
  include_with: z
    .string()
    .optional()
    .describe(
      'sys_id of another sysauto_report job to bundle this report into the same ' +
        'email (the "Include with" field). Omit to send as its own email.',
    ),
});

export const ScheduledReportCreate = ScheduledReportBase.extend({
  report: z
    .string()
    .min(1)
    .describe(
      'sys_id of the report (sys_report) to email. Query sys_report by title to look it up.',
    ),
  output_type: z
    .enum(SCHEDULED_REPORT_OUTPUT_TYPES)
    .optional()
    .default('PDF')
    .describe('Format of the attached report. Defaults to PDF.'),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the job is active. Defaults to true.'),
  run_type: z
    .enum(SCHEDULED_JOB_RUN_TYPES)
    .optional()
    .default('daily')
    .describe('How often the report is sent. Defaults to daily.'),
});

export const ScheduledReportUpdate = ScheduledReportBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the sysauto_report record to update.'),
});

// — Scheduled Entity Generation (sysauto_template) —

const ScheduledRecordGenerationBase = ScheduledJobBase.extend({
  template: z
    .string()
    .optional()
    .describe(
      'sys_id of the template (sys_template) describing the record to generate ' +
        'on schedule. The template encodes the target table and field values.',
    ),
});

export const ScheduledRecordGenerationCreate =
  ScheduledRecordGenerationBase.extend({
    template: z
      .string()
      .min(1)
      .describe(
        'sys_id of the template (sys_template) describing the record to generate. ' +
          'The template encodes the target table and field values.',
      ),
    active: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether the job is active. Defaults to true.'),
    run_type: z
      .enum(SCHEDULED_JOB_RUN_TYPES)
      .optional()
      .default('daily')
      .describe('How often the record is generated. Defaults to daily.'),
  });

export const ScheduledRecordGenerationUpdate =
  ScheduledRecordGenerationBase.partial().extend({
    sys_id: z
      .string()
      .min(1)
      .describe('sys_id of the sysauto_template record to update.'),
  });

// — Read / run —

export const ScheduledJobList = z.object({
  name_contains: z
    .string()
    .optional()
    .describe('Case-insensitive substring to filter job names.'),
  job_type: z
    .enum(['all', 'script', 'report', 'record_generation'])
    .optional()
    .default('all')
    .describe(
      "Filter by job type. 'all' returns every scheduled-job type (queries the " +
        "sysauto base table); 'script' = sysauto_script, 'report' = sysauto_report, " +
        "'record_generation' = sysauto_template.",
    ),
  active_only: z
    .boolean()
    .optional()
    .default(true)
    .describe('Only return active jobs. Defaults to true.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of jobs to return (1–100). Defaults to 20.'),
});

export const ScheduledJobGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the scheduled job (any sysauto record) to read.'),
});

export const ScheduledJobRun = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe(
      'sys_id of the scheduled job (any sysauto record) to execute immediately.',
    ),
});
