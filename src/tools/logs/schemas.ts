import { z } from 'zod';

// ── System & application logs (syslog / syslog_app_scope) ───────────────────
//
// `syslog` ("Log Entry") is the base log table. `syslog_app_scope`
// ("App Log Entry") has super_class = syslog, so a single query against
// `syslog` returns BOTH base and scoped-app rows; `sys_class_name`
// ("syslog" vs "syslog_app_scope") tells them apart. Always query `syslog` —
// never the two tables separately. Records are immutable, so this domain is
// read-only.
//
// `level` is an integer-coded choice stored as a string. Severity is monotonic
// in those codes (verified against the syslog.level sys_choice list):
//   -2 Trace · -1 Debug · 0 Information · 1 Warning · 2 Error · 3 Fatal
//
// Field shapes verified against the syslog / syslog_app_scope dictionaries on
// the PDI.

/** Level names ordered by ascending severity — the single source of truth. */
export const LEVEL_ORDER = [
  'trace',
  'debug',
  'info',
  'warning',
  'error',
  'fatal',
] as const;

export type LevelName = (typeof LEVEL_ORDER)[number];

/** Level name → the integer code stored in `syslog.level`. */
export const LEVEL_CODE: Record<LevelName, number> = {
  trace: -2,
  debug: -1,
  info: 0,
  warning: 1,
  error: 2,
  fatal: 3,
};

/**
 * Builds the `levelIN<codes>` clause covering `min` and every higher severity.
 * e.g. warning → `levelIN1,2,3`, error → `levelIN2,3`, info → `levelIN0,1,2,3`.
 */
export function minLevelClause(min: LevelName): string {
  const floor = LEVEL_CODE[min];
  const codes = LEVEL_ORDER.map((name) => LEVEL_CODE[name])
    .filter((code) => code >= floor)
    .sort((a, b) => a - b);
  return `levelIN${codes.join(',')}`;
}

export const LogList = z.object({
  min_level: z
    .enum(LEVEL_ORDER)
    .optional()
    .describe(
      'Minimum severity to include — returns this level and every higher one ' +
        '(trace<debug<info<warning<error<fatal). e.g. "warning" returns ' +
        'warning, error and fatal. Omit to return all levels.',
    ),
  source_contains: z
    .string()
    .optional()
    .describe(
      'Filter to entries whose source (logger/source string, e.g. a script ' +
        'name) contains this text.',
    ),
  message_contains: z
    .string()
    .optional()
    .describe('Filter to entries whose message contains this text.'),
  minutes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Only entries created in the last N minutes. Omit for no time bound ' +
        '(just the newest entries up to `limit`).',
    ),
  created_by: z
    .string()
    .optional()
    .describe(
      'Filter to entries created by this user (sys_created_by, e.g. "admin" ' +
        'or "system").',
    ),
  scope: z
    .enum(['all', 'global', 'scoped'])
    .optional()
    .default('all')
    .describe(
      'Which class of log to return: "global" → base syslog rows only, ' +
        '"scoped" → scoped-app (syslog_app_scope) rows only, "all" → both. ' +
        'Defaults to "all".',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of entries to return (1–100). Defaults to 50.'),
});

export const LogGet = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the syslog / syslog_app_scope record to read.'),
});
