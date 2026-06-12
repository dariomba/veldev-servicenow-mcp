import type { ServiceNowClient } from '../../clients/servicenow.js';
import { handleError } from '../helpers.js';
import type { ToolRegistry } from '../registry.js';
import { BackgroundScriptExecute } from './schemas.js';

export function registerBackgroundScriptTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'execute_background_script',
    {
      access: 'write',
      title: 'Execute Background Script',
      description: [
        'Schedules a server-side JavaScript snippet to run as a background script',
        'via a sys_trigger record. The script executes in the global scope and has',
        'access to GlideRecord, gs, and all server-side APIs.',
        '',
        'The trigger fires approximately 1 second after creation. Use this to',
        'run one-off maintenance scripts, data fixes, or debug snippets.',
        '',
        'Returns the trigger sys_id, name, and scheduled execution time.',
      ].join('\n'),
      inputSchema: BackgroundScriptExecute,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ script }) => {
      try {
        const result = await client.executeBackgroundScriptTrigger(script);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Background script scheduled successfully.`,
                ``,
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
