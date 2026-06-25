import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { SnRecord } from '../../types/servicenow.js';
import {
  disp,
  errText,
  handleError,
  recordUrl,
  requireSysId,
  richResult,
  textResult,
  val,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import { LogGet, LogList, minLevelClause } from './schemas.js';

// Both base (syslog) and scoped-app (syslog_app_scope) rows live under this one
// table — syslog_app_scope extends syslog — so a single query returns both.
const TABLE = 'syslog';

export function registerLogTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'list_logs',
    {
      access: 'read',
      title: 'List Log Entries',
      description: [
        'Lists system and application log entries from the `syslog` table —',
        'the debugging/observability counterpart to the write tools. Answers',
        '"I built it and it doesn\'t work, why?".',
        '',
        'A single query covers both base log entries (sys_class_name=syslog) and',
        'scoped-app log entries (sys_class_name=syslog_app_scope, which extends',
        'syslog). Newest first.',
        '',
        'Filter by min_level (this severity and all higher), source/message',
        'substring, time window (last N minutes), creating user, and scope.',
        'Use get_log for the full record (message, context_map, scope details).',
      ].join('\n'),
      inputSchema: LogList,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({
      min_level,
      source_contains,
      message_contains,
      minutes,
      created_by,
      scope,
      limit,
    }) => {
      try {
        const clauses: string[] = [];
        if (min_level) clauses.push(minLevelClause(min_level));
        if (source_contains) clauses.push(`sourceLIKE${source_contains}`);
        if (message_contains) clauses.push(`messageLIKE${message_contains}`);
        if (minutes !== undefined)
          clauses.push(`sys_created_onRELATIVEGE@minute@ago@${minutes}`);
        if (created_by) clauses.push(`sys_created_by=${created_by}`);
        if (scope === 'global') clauses.push('sys_class_name=syslog');
        else if (scope === 'scoped')
          clauses.push('sys_class_name=syslog_app_scope');
        clauses.push('ORDERBYDESCsys_created_on');

        const rows = await client.listRecords<SnRecord>(
          TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'sys_created_on',
            'level',
            'source',
            'sys_created_by',
            'sys_class_name',
            'message',
          ],
          limit,
        );

        const summary = rows.length
          ? rows
              .map((r) => {
                const rawMsg = val(r, 'message');
                const snippet =
                  rawMsg.length > 100
                    ? `${rawMsg.slice(0, 97)}...`
                    : rawMsg || '(empty)';
                return (
                  `[${disp(r, 'sys_created_on')}] ${disp(r, 'level')} ` +
                  `${val(r, 'source') || '(no source)'} — ${snippet} — ${val(r, 'sys_id')}`
                );
              })
              .join('\n')
          : 'No log entries matched.';

        return textResult(summary);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'get_log',
    {
      access: 'read',
      title: 'Get Log Entry',
      description: [
        'Reads a single log entry from `syslog` by sys_id: its level, source,',
        'full message, name-value context_map, and — for scoped-app entries',
        '(syslog_app_scope) — the originating app scope and script artifact.',
      ].join('\n'),
      inputSchema: LogGet,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sys_id }) => {
      try {
        const idErr = requireSysId(sys_id, 'syslog sys_id');
        if (idErr) return errText(idErr);

        const base = await client.getRecord<SnRecord>(TABLE, sys_id);
        // The row's own class (syslog | syslog_app_scope) — also the table its
        // record URL points at.
        const className = val(base, 'sys_class_name') || TABLE;

        const result: Record<string, unknown> = {
          sys_id: val(base, 'sys_id'),
          sys_class_name: disp(base, 'sys_class_name'),
          level: disp(base, 'level'),
          source: val(base, 'source'),
          message: val(base, 'message'),
          context_map: val(base, 'context_map'),
          sequence: val(base, 'sequence'),
          created: disp(base, 'sys_created_on'),
          created_by: val(base, 'sys_created_by'),
        };

        // Scoped-app-only columns — present only on syslog_app_scope rows.
        const sysScope = disp(base, 'sys_scope');
        if (sysScope) result.sys_scope = sysScope;
        const scriptArtifact = val(base, 'script_artifact');
        if (scriptArtifact) result.script_artifact = scriptArtifact;
        const scriptArtifactTable = val(base, 'script_artifact_table');
        if (scriptArtifactTable)
          result.script_artifact_table = scriptArtifactTable;

        result.url = recordUrl(client, className, sys_id);

        const summary = [
          `Log Entry: ${result.level} from ${result.source || '(no source)'} (${result.sys_id})`,
          `Created:   ${result.created} by ${result.created_by}`,
          `Class:     ${result.sys_class_name}${
            result.sys_scope ? ` · scope ${result.sys_scope}` : ''
          }`,
          `Message:   ${(result.message as string).length} chars`,
          `URL:       ${result.url}`,
        ].join('\n');

        return richResult(summary, result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
