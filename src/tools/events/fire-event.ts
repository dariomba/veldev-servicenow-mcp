import type { ServiceNowClient } from '../../clients/servicenow.js';
import { handleError, isSysId } from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import { FireEvent } from './schemas.js';

export function registerFireEventTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'fire_event',
    {
      access: 'write',
      title: 'Fire Event',
      description: [
        'Fires an event at runtime via gs.eventQueue(), queuing it for processing so',
        'script actions and event-driven notifications registered on that event name run.',
        '',
        'Pass record_table + record_sys_id to attach a record — listeners then receive it',
        'as `current` (and event.instance = its sys_id). parm1/parm2 are optional strings',
        'readable as event.parm1 / event.parm2.',
        '',
        'Runs a one-shot background script (~1s delay via sys_trigger). The event_name',
        'should match a registered event (sysevent_register) or no listener will react.',
      ].join('\n'),
      inputSchema: FireEvent,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ event_name, record_table, record_sys_id, parm1, parm2 }) => {
      try {
        const hasTable = record_table !== undefined;
        const hasSysId = record_sys_id !== undefined;
        if (hasTable !== hasSysId) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'record_table and record_sys_id must be provided together (or both omitted).',
              },
            ],
            isError: true,
          };
        }
        if (hasSysId && !isSysId(record_sys_id as string)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `"${record_sys_id}" is not a valid record sys_id.`,
              },
            ],
            isError: true,
          };
        }

        // JSON.stringify yields a safe JS string literal for each interpolated value.
        const lines: string[] = ['var gr = null;'];
        if (hasTable && hasSysId) {
          lines.push(
            `var _g = new GlideRecord(${JSON.stringify(record_table)});`,
            `if (_g.get(${JSON.stringify(record_sys_id)})) { gr = _g; }`,
          );
        }
        lines.push(
          `gs.eventQueue(${JSON.stringify(event_name)}, gr, ${JSON.stringify(parm1 ?? '')}, ${JSON.stringify(parm2 ?? '')});`,
        );
        const script = lines.join('\n');

        const result = await client.executeBackgroundScriptTrigger(script);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Event fire requested.',
                '',
                `event_name:     ${event_name}`,
                `record:         ${hasTable ? `${record_table}/${record_sys_id}` : '(none)'}`,
                `parm1:          ${parm1 ?? ''}`,
                `parm2:          ${parm2 ?? ''}`,
                `trigger_sys_id: ${result.trigger_sys_id}`,
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
