import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from '../clients/servicenow.js';
import type { RawUpdateSet, RawUserPreference } from '../types/servicenow.js';
import { handleError, resolveDisplay, resolveValue } from './helpers.js';

export function registerUpdateSetTools(
  server: McpServer,
  client: ServiceNowClient,
): void {
  server.registerTool(
    'get_current_update_set',
    {
      title: 'Get Current Update Set',
      description: [
        'Returns the name and application scope of the active Update Set for the authenticated user.',
        '',
        'WHEN TO USE: Call this when the user asks which Update Set is currently active.',
        '',
        'No parameters required — the authenticated user is resolved automatically.',
        '',
        'If no preference is found, the user is on the default Update Set for each scope.',
      ].join('\n'),
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const username = client.getUsername();

        if (!username) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Cannot resolve the current Update Set: the connection is not tied to a named user (e.g. OAuth client_credentials grant). Use basic auth or an OAuth password grant for this tool.',
              },
            ],
          };
        }

        const prefs = await client.listRecords<RawUserPreference>(
          'sys_user_preference',
          `name=sys_update_set^user.user_name=${username}`,
          ['value'],
          1,
        );

        if (prefs.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No active Update Set preference found. The default Update Set for each scope is active.',
              },
            ],
          };
        }

        const updateSetSysId = resolveValue(prefs[0].value);

        const updateSet = await client.getRecord<RawUpdateSet>(
          'sys_update_set',
          updateSetSysId,
          ['name', 'application'],
        );

        const name = resolveDisplay(updateSet.name);
        const application = resolveDisplay(updateSet.application);
        const applicationSysId = resolveValue(updateSet.application);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Name: ${name}\nApplication: ${application} (${applicationSysId})`,
            },
          ],
        };
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
