import type { ServiceNowClient } from '../clients/servicenow.js';
import type { SnReference } from '../types/servicenow.js';
import {
  handleError,
  isSysId,
  resolveDisplay,
  resolveValue,
} from './helpers.js';
import type { ToolRegistry } from './registry.js';
import {
  ScheduledJobGet,
  ScheduledJobList,
  ScheduledJobRun,
  ScheduledRecordGenerationCreate,
  ScheduledRecordGenerationUpdate,
  ScheduledReportCreate,
  ScheduledReportUpdate,
  ScheduledScriptCreate,
  ScheduledScriptUpdate,
} from './schemas.js';

const BASE_TABLE = 'sysauto';
const SCRIPT_TABLE = 'sysauto_script';
const REPORT_TABLE = 'sysauto_report';
const TEMPLATE_TABLE = 'sysauto_template';
const TRIGGER_TABLE = 'sys_trigger';

type SnRecord = Record<string, SnReference | undefined>;

const val = (r: SnRecord, f: string): string =>
  r[f] ? resolveValue(r[f] as SnReference) : '';
const disp = (r: SnRecord, f: string): string =>
  r[f] ? resolveDisplay(r[f] as SnReference) : '';

const DAY_NAMES = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const WEEK_NAMES = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const dayName = (r: SnRecord) =>
  DAY_NAMES[Number(val(r, 'run_dayofweek')) || 0] || '?';
/** Comma-separated day names from run_daysofweek (e.g. "2,3" → "Tuesday, Wednesday"). */
const daysOfWeekNames = (r: SnRecord) =>
  val(r, 'run_daysofweek')
    .split(',')
    .map((d) => DAY_NAMES[Number(d) || 0] || '?')
    .join(', ');
const weekName = (r: SnRecord) =>
  WEEK_NAMES[Number(val(r, 'run_weekinmonth')) || 0] || '?';
const monthName = (r: SnRecord) =>
  MONTH_NAMES[Number(val(r, 'run_month')) || 0] || '?';

/** Type-specific columns surfaced by get_scheduled_job, keyed by sys_class_name. */
const TYPE_FIELDS: Record<string, string[]> = {
  [SCRIPT_TABLE]: ['script'],
  [REPORT_TABLE]: [
    'report',
    'report_title',
    'output_type',
    'user_list',
    'group_list',
    'address_list',
    'include_detail',
    'zip',
    'omit_if_no_records',
  ],
  [TEMPLATE_TABLE]: ['template'],
};

const JOB_TYPE_TABLE: Record<string, string> = {
  script: SCRIPT_TABLE,
  report: REPORT_TABLE,
  record_generation: TEMPLATE_TABLE,
};

function recordUrl(
  client: ServiceNowClient,
  table: string,
  sysId: string,
): string {
  return `${client.getInstanceUrl()}/${table}.do?sys_id=${sysId}`;
}

function errText(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/** Common scheduling input shared by every job type's create/update schema. */
interface ScheduleInput {
  active?: boolean;
  run_type?: string;
  run_time?: string;
  run_dayofweek?: number;
  run_daysofweek?: number[];
  run_dayofmonth?: number;
  run_weekinmonth?: number;
  run_month?: number;
  period_days?: number;
  period_hours?: number;
  period_minutes?: number;
  period_seconds?: number;
  run_start?: string;
  run_end?: string;
  time_zone?: string;
  business_calendar?: string;
  offset_type?: 'future' | 'past';
  offset_days?: number;
  offset_hours?: number;
  offset_minutes?: number;
  offset_seconds?: number;
  conditional?: boolean;
  condition?: string;
  run_as?: string;
}

/**
 * A glide_duration is stored as a date/time offset from the 1970-01-01 epoch:
 * 1 hour → "1970-01-01 01:00:00", 1 day → "1970-01-02 00:00:00". Returns
 * undefined when every component is omitted so the field is left untouched.
 */
function buildDuration(
  days?: number,
  hours?: number,
  minutes?: number,
  seconds?: number,
): string | undefined {
  if (
    days === undefined &&
    hours === undefined &&
    minutes === undefined &&
    seconds === undefined
  ) {
    return undefined;
  }
  const totalSeconds =
    (days ?? 0) * 86400 +
    (hours ?? 0) * 3600 +
    (minutes ?? 0) * 60 +
    (seconds ?? 0);
  const d = new Date(Date.UTC(1970, 0, 1) + totalSeconds * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Maps the shared scheduling inputs onto a ServiceNow Table API body. */
function applyScheduleFields(
  body: Record<string, unknown>,
  input: ScheduleInput,
): void {
  if (input.active !== undefined) body.active = String(input.active);
  if (input.run_type !== undefined) body.run_type = input.run_type;
  // run_daysofweek (the "Days of Week" multi-checkbox) takes precedence: it
  // switches the trigger into "Days in Week" mode and fires on every listed day.
  if (input.run_daysofweek !== undefined)
    body.run_daysofweek = input.run_daysofweek.join(',');
  if (input.run_dayofweek !== undefined)
    body.run_dayofweek = String(input.run_dayofweek);
  if (input.run_dayofmonth !== undefined)
    body.run_dayofmonth = String(input.run_dayofmonth);
  if (input.run_weekinmonth !== undefined)
    body.run_weekinmonth = String(input.run_weekinmonth);
  if (input.run_month !== undefined) body.run_month = String(input.run_month);

  // Time-of-day, start and end. When a time_zone is given we switch the record
  // into ServiceNow's "advanced" mode: the wall-clock values go into the
  // entered_* fields with `time_zone` set, and SN derives the GMT run_time /
  // run_start / run_end itself — DST-aware for the actual run date. Writing
  // run_time directly (and time_zone into the legacy run_as_tz field) stored a
  // raw GMT clock that drifted an hour across daylight-saving boundaries.
  if (input.time_zone !== undefined) {
    body.time_zone = input.time_zone;
    body.advanced = 'true';
    body.run_as_tz = ''; // legacy field — must stay empty in advanced mode
    if (input.run_time !== undefined) body.entered_time = input.run_time;
    if (input.run_start !== undefined) body.entered_run_start = input.run_start;
    if (input.run_end !== undefined) body.entered_run_end = input.run_end;
  } else {
    if (input.run_time !== undefined) body.run_time = input.run_time;
    if (input.run_start !== undefined) body.run_start = input.run_start;
    if (input.run_end !== undefined) body.run_end = input.run_end;
  }
  if (input.business_calendar !== undefined)
    body.business_calendar = input.business_calendar;
  // offset_type stores 1=Future, 2=Past.
  if (input.offset_type !== undefined)
    body.offset_type = input.offset_type === 'past' ? '2' : '1';
  if (input.conditional !== undefined)
    body.conditional = String(input.conditional);
  if (input.condition !== undefined) body.condition = input.condition;
  if (input.run_as !== undefined) body.run_as = input.run_as;

  const period = buildDuration(
    input.period_days,
    input.period_hours,
    input.period_minutes,
    input.period_seconds,
  );
  if (period !== undefined) body.run_period = period;

  const offset = buildDuration(
    input.offset_days,
    input.offset_hours,
    input.offset_minutes,
    input.offset_seconds,
  );
  if (offset !== undefined) body.offset = offset;
}

/** Report-specific input (sysauto_report), shared by its create and update. */
interface ReportInput {
  report?: string;
  report_title?: string;
  report_body?: string;
  user_list?: string;
  group_list?: string;
  address_list?: string;
  output_type?: string;
  include_detail?: boolean;
  zip?: boolean;
  omit_if_no_records?: boolean;
  page_size?: string;
  page_height_in_pixels?: number;
  page_width_in_pixels?: number;
  include_with?: string;
}

/** Maps sysauto_report-specific inputs onto a ServiceNow Table API body. */
function applyReportFields(
  body: Record<string, unknown>,
  input: ReportInput,
): void {
  if (input.report !== undefined) body.report = input.report;
  if (input.report_title !== undefined) body.report_title = input.report_title;
  if (input.report_body !== undefined) body.report_body = input.report_body;
  if (input.user_list !== undefined) body.user_list = input.user_list;
  if (input.group_list !== undefined) body.group_list = input.group_list;
  if (input.address_list !== undefined) body.address_list = input.address_list;
  if (input.output_type !== undefined) body.output_type = input.output_type;
  if (input.include_detail !== undefined)
    body.include_detail = String(input.include_detail);
  if (input.zip !== undefined) body.zip = String(input.zip);
  if (input.omit_if_no_records !== undefined)
    body.omit_if_no_records = String(input.omit_if_no_records);
  if (input.page_size !== undefined) body.page_size = input.page_size;
  if (input.page_height_in_pixels !== undefined)
    body.page_height_in_pixels = String(input.page_height_in_pixels);
  if (input.page_width_in_pixels !== undefined)
    body.page_width_in_pixels = String(input.page_width_in_pixels);
  if (input.include_with !== undefined) body.include_with = input.include_with;
}

/**
 * Human-readable one-line schedule. The time-of-day stores as
 * "1970-01-01 HH:MM:SS"; we surface just the HH:MM:SS and tag it with the
 * time_zone the scheduler evaluates it in, else the instance default.
 * run_start is absolute UTC.
 */
function scheduleSummary(r: SnRecord): string {
  const type = val(r, 'run_type');
  const tz =
    val(r, 'time_zone') || val(r, 'run_as_tz') || 'instance default tz';
  // In advanced (time_zone) mode entered_time holds the wall-clock the user
  // set; run_time is its GMT derivation. Surface the wall-clock when present.
  const clock = val(r, 'entered_time') || val(r, 'run_time');
  const time = `${clock.slice(-8) || '00:00:00'} ${tz}`;
  const start = val(r, 'run_start');
  const until = val(r, 'run_end') ? ` until ${val(r, 'run_end')} UTC` : '';
  const cal = disp(r, 'business_calendar');
  const offset = `${disp(r, 'offset') || '0'} ${disp(r, 'offset_type') || 'Future'}`;
  switch (type) {
    case 'daily':
      return `Daily at ${time}${until}`;
    case 'weekly':
      return `Weekly on ${val(r, 'run_daysofweek') ? daysOfWeekNames(r) : dayName(r)} at ${time}${until}`;
    case 'monthly':
      return `Monthly on day ${val(r, 'run_dayofmonth')} at ${time}${until}`;
    case 'week_in_month':
      return `Monthly on the ${weekName(r)} ${dayName(r)} at ${time}${until}`;
    case 'day_and_month_in_year':
      return `Yearly on ${monthName(r)} ${val(r, 'run_dayofmonth')} at ${time}${until}`;
    case 'day_week_month_year':
      return `Yearly on the ${weekName(r)} ${dayName(r)} of ${monthName(r)} at ${time}${until}`;
    case 'periodically':
      return `Every ${disp(r, 'run_period') || '?'} from ${start} UTC${until}`;
    case 'once':
      return `Once at ${start} UTC`;
    case 'business_calendar_start':
      return `${offset} from each "${cal}" entry start`;
    case 'business_calendar_end':
      return `${offset} from each "${cal}" entry end`;
    case 'on_demand':
      return 'On demand only';
    default:
      return type || '(unspecified)';
  }
}

export function registerScheduledJobTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  // ── Create / update: Scheduled Script Execution ───────────────────────────
  registry.registerTool(
    'create_scheduled_script',
    {
      access: 'write',
      title: 'Create Scheduled Script Execution',
      description: [
        'Creates a sysauto_script record — a Scheduled Script Execution that runs',
        'server-side JavaScript on a schedule. ServiceNow auto-creates the backing',
        'sys_trigger; you do not manage it directly.',
        '',
        'run_time is "HH:MM:SS" — set time_zone (e.g. "US/Eastern") to fire at that',
        'wall-clock time in a specific zone (DST-safe), else the instance default.',
        'run_start is an absolute UTC "YYYY-MM-DD HH:MM:SS". For run_type=periodically',
        'pass the interval via period_days/hours/minutes/seconds.',
        '',
        'Idempotent: if a sysauto_script with the same name already exists, its',
        'sys_id is returned and no new record is created.',
      ].join('\n'),
      inputSchema: ScheduledScriptCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const existing = await client.listRecords<SnRecord>(
          SCRIPT_TABLE,
          `name=${input.name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return skipped('Scheduled Script Execution', input.name, existing[0]);
        }

        const body: Record<string, unknown> = {
          name: input.name,
          script: input.script,
        };
        applyScheduleFields(body, input);

        const rec = await client.createRecord<SnRecord>(SCRIPT_TABLE, body);
        return created(client, 'Scheduled Script Execution', SCRIPT_TABLE, rec);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_scheduled_script',
    {
      access: 'write',
      title: 'Update Scheduled Script Execution',
      description: [
        'Updates fields on an existing sysauto_script record.',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
      ].join('\n'),
      inputSchema: ScheduledScriptUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, name, script, ...schedule }) => {
      try {
        if (!isSysId(sys_id))
          return errText(`"${sys_id}" is not a valid sysauto_script sys_id.`);
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (script !== undefined) body.script = script;
        applyScheduleFields(body, schedule);
        return updated(client, SCRIPT_TABLE, sys_id, body);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Create / update: Scheduled Email of Report ────────────────────────────
  registry.registerTool(
    'create_scheduled_report',
    {
      access: 'write',
      title: 'Create Scheduled Email of Report',
      description: [
        'Creates a sysauto_report record — a Scheduled Email of Report that',
        'generates a report and emails it to users/groups/addresses on a schedule.',
        '',
        'Requires `report` (sys_id of a sys_report). Recipients: user_list and',
        'group_list are comma-separated sys_ids; address_list is comma-separated emails.',
        'Scheduling/time_zone behave as in create_scheduled_script.',
        '',
        'Idempotent on name.',
      ].join('\n'),
      inputSchema: ScheduledReportCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const existing = await client.listRecords<SnRecord>(
          REPORT_TABLE,
          `name=${input.name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return skipped('Scheduled Email of Report', input.name, existing[0]);
        }

        const body: Record<string, unknown> = { name: input.name };
        applyReportFields(body, input);
        applyScheduleFields(body, input);

        const rec = await client.createRecord<SnRecord>(REPORT_TABLE, body);
        return created(client, 'Scheduled Email of Report', REPORT_TABLE, rec);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_scheduled_report',
    {
      access: 'write',
      title: 'Update Scheduled Email of Report',
      description: [
        'Updates fields on an existing sysauto_report record.',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
      ].join('\n'),
      inputSchema: ScheduledReportUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, name, ...rest }) => {
      try {
        if (!isSysId(sys_id))
          return errText(`"${sys_id}" is not a valid sysauto_report sys_id.`);
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        applyReportFields(body, rest);
        applyScheduleFields(body, rest);
        return updated(client, REPORT_TABLE, sys_id, body);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Create / update: Scheduled Entity Generation ──────────────────────────
  registry.registerTool(
    'create_scheduled_record_generation',
    {
      access: 'write',
      title: 'Create Scheduled Record Generation',
      description: [
        'Creates a sysauto_template record — a Scheduled Entity Generation that',
        'creates a record (incident, change, CI, etc.) from a Template on a schedule.',
        '',
        'Requires `template` (sys_id of a sys_template). The template encodes the',
        'target table and the field values of the record to generate.',
        'Scheduling/time_zone behave as in create_scheduled_script. Idempotent on name.',
      ].join('\n'),
      inputSchema: ScheduledRecordGenerationCreate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const existing = await client.listRecords<SnRecord>(
          TEMPLATE_TABLE,
          `name=${input.name}`,
          ['sys_id'],
          1,
        );
        if (existing.length > 0) {
          return skipped(
            'Scheduled Record Generation',
            input.name,
            existing[0],
          );
        }

        const body: Record<string, unknown> = {
          name: input.name,
          template: input.template,
        };
        applyScheduleFields(body, input);

        const rec = await client.createRecord<SnRecord>(TEMPLATE_TABLE, body);
        return created(
          client,
          'Scheduled Record Generation',
          TEMPLATE_TABLE,
          rec,
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'update_scheduled_record_generation',
    {
      access: 'write',
      title: 'Update Scheduled Record Generation',
      description: [
        'Updates fields on an existing sysauto_template record.',
        'Pass only the fields you want to change — omitted fields are left unchanged.',
      ].join('\n'),
      inputSchema: ScheduledRecordGenerationUpdate,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sys_id, name, template, ...schedule }) => {
      try {
        if (!isSysId(sys_id))
          return errText(`"${sys_id}" is not a valid sysauto_template sys_id.`);
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (template !== undefined) body.template = template;
        applyScheduleFields(body, schedule);
        return updated(client, TEMPLATE_TABLE, sys_id, body);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Read: list ────────────────────────────────────────────────────────────
  registry.registerTool(
    'list_scheduled_jobs',
    {
      access: 'read',
      title: 'List Scheduled Jobs',
      description: [
        'Lists scheduled jobs from the sysauto table hierarchy. job_type=all',
        'returns every job type (data imports, data collection, reports, scripts,',
        'etc.); the other values narrow to a single child table.',
      ].join('\n'),
      inputSchema: ScheduledJobList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name_contains, job_type, active_only, limit }) => {
      try {
        const table = JOB_TYPE_TABLE[job_type] ?? BASE_TABLE;
        const clauses: string[] = [];
        if (active_only) clauses.push('active=true');
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        clauses.push('ORDERBYname');

        const rows = await client.listRecords<SnRecord>(
          table,
          clauses.join('^'),
          ['sys_id', 'name', 'sys_class_name', 'active', 'run_type'],
          limit,
        );

        const jobs = rows.map((r) => ({
          sys_id: val(r, 'sys_id'),
          name: disp(r, 'name'),
          type: disp(r, 'sys_class_name') || table,
          active: val(r, 'active') === 'true',
          run_type: val(r, 'run_type'),
        }));

        const summary = jobs.length
          ? jobs
              .map(
                (j) =>
                  `${j.name} — ${j.type} — ${j.run_type}${j.active ? '' : ' (inactive)'} — ${j.sys_id}`,
              )
              .join('\n')
          : 'No scheduled jobs matched.';

        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // ── Read: get (rich) ──────────────────────────────────────────────────────
  registry.registerTool(
    'get_scheduled_job',
    {
      access: 'read',
      title: 'Get Scheduled Job',
      description: [
        'Reads a single scheduled job (any sysauto record) with its resolved',
        'schedule, type-specific fields, and the next run time from its sys_trigger.',
      ].join('\n'),
      inputSchema: ScheduledJobGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        if (!isSysId(sys_id))
          return errText(`"${sys_id}" is not a valid scheduled job sys_id.`);

        const base = await client.getRecord<SnRecord>(BASE_TABLE, sys_id, [
          'sys_id',
          'name',
          'sys_class_name',
          'active',
          'run_type',
          'run_time',
          'run_dayofweek',
          'run_daysofweek',
          'run_dayofmonth',
          'run_weekinmonth',
          'run_month',
          'run_period',
          'run_start',
          'run_end',
          'entered_time',
          'time_zone',
          'run_as_tz',
          'business_calendar',
          'offset',
          'offset_type',
          'conditional',
          'condition',
          'run_as',
        ]);

        const className = val(base, 'sys_class_name') || BASE_TABLE;
        const typeFields = TYPE_FIELDS[className];

        const [typeRec, triggers] = await Promise.all([
          typeFields
            ? client.getRecord<SnRecord>(className, sys_id, typeFields)
            : Promise.resolve<SnRecord | undefined>(undefined),
          client.listRecords<SnRecord>(
            TRIGGER_TABLE,
            `document=${className}^document_key=${sys_id}`,
            ['next_action', 'state'],
            1,
          ),
        ]);

        const typeDetails: Record<string, string> = {};
        if (typeRec && typeFields) {
          for (const f of typeFields) typeDetails[f] = disp(typeRec, f);
        }

        // next_action is glide_date_time — its display value renders in the
        // instance's own tz, which misleads for a job scheduled in another zone.
        // Surface the absolute UTC value instead.
        const nextRun = triggers[0] ? val(triggers[0], 'next_action') : '';
        const result = {
          sys_id: val(base, 'sys_id'),
          name: disp(base, 'name'),
          type: className,
          active: val(base, 'active') === 'true',
          run_type: val(base, 'run_type'),
          schedule: scheduleSummary(base),
          time_zone: disp(base, 'time_zone') || disp(base, 'run_as_tz'),
          run_end: val(base, 'run_end'),
          conditional: val(base, 'conditional') === 'true',
          condition: disp(base, 'condition'),
          run_as: disp(base, 'run_as'),
          next_run: nextRun
            ? `${nextRun} UTC`
            : '(none — inactive or on demand)',
          url: recordUrl(client, className, sys_id),
          details: typeDetails,
        };

        const summary = [
          `Job:      ${result.name} (${result.sys_id})`,
          `Type:     ${result.type}`,
          `Active:   ${result.active}`,
          `Schedule: ${result.schedule}`,
          `Next run: ${result.next_run}`,
          result.conditional ? `Condition: ${result.condition}` : null,
          result.run_as ? `Run as:   ${result.run_as}` : null,
          `URL:      ${result.url}`,
        ]
          .filter(Boolean)
          .join('\n');

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

  // ── Write: execute now ────────────────────────────────────────────────────
  registry.registerTool(
    'run_scheduled_job',
    {
      access: 'write',
      title: 'Run Scheduled Job Now',
      description: [
        'Executes a scheduled job (any sysauto record) immediately, outside its',
        'normal schedule — the equivalent of the "Execute Now" UI action.',
        '',
        'Runs SncTriggerSynchronizer.executeNow(job) via a background trigger that',
        'fires ~1 second after creation. Returns the trigger details.',
      ].join('\n'),
      inputSchema: ScheduledJobRun,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ sys_id }) => {
      try {
        if (!isSysId(sys_id))
          return errText(`"${sys_id}" is not a valid scheduled job sys_id.`);

        const runnerScript = [
          `var gr = new GlideRecord('${BASE_TABLE}');`,
          `if (gr.get('${sys_id}')) {`,
          `    SncTriggerSynchronizer.executeNow(gr);`,
          `}`,
        ].join('\n');

        const result =
          await client.executeBackgroundScriptTrigger(runnerScript);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Scheduled job execution requested.',
                '',
                `job_sys_id:     ${sys_id}`,
                `trigger_sys_id: ${result.trigger_sys_id}`,
                `trigger_name:   ${result.trigger_name}`,
                `next_action:    ${result.next_action}`,
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

// ── Shared result builders ──────────────────────────────────────────────────

function skipped(label: string, name: string, existing: SnRecord) {
  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `${label} "${name}" already exists — skipped.`,
          `sys_id: ${val(existing, 'sys_id')}`,
        ].join('\n'),
      },
    ],
  };
}

function created(
  client: ServiceNowClient,
  label: string,
  table: string,
  rec: SnRecord,
) {
  const sysId = val(rec, 'sys_id');
  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `${label} created.`,
          '',
          `name:   ${disp(rec, 'name')}`,
          `sys_id: ${sysId}`,
          `schedule: ${scheduleSummary(rec)}`,
          `URL:    ${recordUrl(client, table, sysId)}`,
        ].join('\n'),
      },
    ],
  };
}

async function updated(
  client: ServiceNowClient,
  table: string,
  sysId: string,
  body: Record<string, unknown>,
) {
  if (Object.keys(body).length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'No fields to update — all values were omitted.',
        },
      ],
    };
  }
  await client.patchRecord<unknown>(table, sysId, body);
  return {
    content: [
      {
        type: 'text' as const,
        text: [
          'Scheduled job updated successfully.',
          '',
          `sys_id:         ${sysId}`,
          `Updated fields: ${Object.keys(body).join(', ')}`,
          `URL:            ${recordUrl(client, table, sysId)}`,
        ].join('\n'),
      },
    ],
  };
}
