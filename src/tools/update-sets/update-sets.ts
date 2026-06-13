import type { ServiceNowClient } from '../../clients/servicenow.js';
import type {
  RawUpdateSet,
  RawUserPreference,
  SnReference,
} from '../../types/servicenow.js';
import {
  boolStr,
  handleError,
  isSysId,
  resolveDisplay,
  resolveValue,
  richResult,
  textResult,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';
import {
  SetCurrentUpdateSet,
  UpdateSetCreate,
  UpdateSetList,
} from './schemas.js';

const UPDATE_SET_TABLE = 'sys_update_set';
const PREFERENCE_TABLE = 'sys_user_preference';
const USER_TABLE = 'sys_user';
/** The single, non-scope-suffixed preference that holds a user's active set. */
const PREFERENCE_NAME = 'sys_update_set';

const NO_NAMED_USER_MESSAGE =
  'Cannot resolve the current Update Set: the connection is not tied to a ' +
  'named user (e.g. OAuth client_credentials grant). Use basic auth or an ' +
  'OAuth password grant for this tool.';

/**
 * Always-on reminder appended to create/switch output. The current update set
 * lives in the browser's live session, which no back-end write can move — so
 * the UI picker is the single source of truth and this stateless server simply
 * follows whatever preference it reads on each call.
 */
const UI_PICKER_REMINDER =
  'NOTE: changes made through this server are captured in the current update ' +
  'set, but this does NOT move the update set picker in an already-open ' +
  'ServiceNow UI session. For MANUAL UI changes to land in the same set, select ' +
  'it in the picker in your browser — that selection is the single source of ' +
  'truth and this server follows it on every call.';

/**
 * Resolves an update set reference (sys_id or exact name) to its sys_id and
 * display name, verifying it exists.
 */
async function resolveUpdateSet(
  client: ServiceNowClient,
  updateSet: string,
): Promise<{ sysId: string; name: string }> {
  if (isSysId(updateSet)) {
    const record = await client.getRecord<RawUpdateSet>(
      UPDATE_SET_TABLE,
      updateSet,
      ['sys_id', 'name'],
    );
    return { sysId: updateSet, name: resolveDisplay(record.name) };
  }

  const matches = await client.listRecords<RawUpdateSet>(
    UPDATE_SET_TABLE,
    `name=${updateSet}`,
    ['sys_id', 'name'],
    5,
  );
  if (matches.length === 0) {
    throw new Error(
      `No update set found named "${updateSet}". Pass the sys_id directly.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple update sets are named "${updateSet}". Pass the sys_id directly.`,
    );
  }
  return {
    sysId: resolveValue(matches[0].sys_id as SnReference),
    name: resolveDisplay(matches[0].name),
  };
}

/**
 * Points the user's single `sys_update_set` preference at the target set,
 * inserting the preference row if the user has none yet.
 */
async function applyCurrentUpdateSet(
  client: ServiceNowClient,
  username: string,
  targetSysId: string,
): Promise<void> {
  const prefs = await client.listRecords<{ sys_id: SnReference }>(
    PREFERENCE_TABLE,
    `name=${PREFERENCE_NAME}^user.user_name=${username}`,
    ['sys_id'],
    1,
  );

  if (prefs.length > 0) {
    await client.patchRecord(PREFERENCE_TABLE, resolveValue(prefs[0].sys_id), {
      value: targetSysId,
    });
    return;
  }

  const users = await client.listRecords<{ sys_id: SnReference }>(
    USER_TABLE,
    `user_name=${username}`,
    ['sys_id'],
    1,
  );
  if (users.length === 0) {
    throw new Error(
      `Could not resolve a sys_user record for "${username}" to create the preference.`,
    );
  }

  await client.createRecord(PREFERENCE_TABLE, {
    name: PREFERENCE_NAME,
    user: resolveValue(users[0].sys_id),
    value: targetSysId,
    type: 'string',
  });
}

/**
 * Optionally points a second, human user's preference at the same set so it
 * shows as current in THAT user's ServiceNow UI. Best-effort: a failure here
 * (e.g. unknown username) never fails the primary operation — it returns a
 * note line instead. Skips when the UI user is the authenticated user.
 */
async function alsoSetForUiUser(
  client: ServiceNowClient,
  authUsername: string,
  uiUsername: string | undefined,
  targetSysId: string,
): Promise<string[]> {
  if (!uiUsername || uiUsername === authUsername) return [];
  try {
    await applyCurrentUpdateSet(client, uiUsername, targetSysId);
    return [
      `Also set as current for UI user "${uiUsername}" — visible in their ServiceNow UI ` +
        'after they reload the page / start a new session.',
    ];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [`Note: could not also set it for UI user "${uiUsername}": ${msg}`];
  }
}

export function registerUpdateSetTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'get_current_update_set',
    {
      access: 'read',
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
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const username = client.getUsername();

        if (!username) {
          return textResult(NO_NAMED_USER_MESSAGE);
        }

        const prefs = await client.listRecords<RawUserPreference>(
          'sys_user_preference',
          `name=sys_update_set^user.user_name=${username}`,
          ['value'],
          1,
        );

        if (prefs.length === 0) {
          return textResult(
            'No active Update Set preference found. The default Update Set for each scope is active.',
          );
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

        return textResult(
          `Name: ${name}\nApplication: ${application} (${applicationSysId})`,
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'list_update_sets',
    {
      access: 'read',
      title: 'List Update Sets',
      description: [
        'Lists Update Sets (sys_update_set), filtered by state, application scope,',
        'or name. Defaults to state="in progress" — the sets you can still add',
        'changes to.',
        '',
        'WHEN TO USE: to find an existing update set before switching to it, or to',
        'review what work is captured in each set.',
        '',
        'The "default: yes" sets are the system-managed per-scope Default update',
        'sets — usually you create a named set instead of working in Default.',
      ].join('\n'),
      inputSchema: UpdateSetList.shape,
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ state, application, name_contains, limit }) => {
      try {
        const clauses = [`state=${state ?? 'in progress'}`];
        if (application) clauses.push(`application=${application}`);
        if (name_contains) clauses.push(`nameLIKE${name_contains}`);
        clauses.push('ORDERBYDESCsys_updated_on');

        const records = await client.listRecords<RawUpdateSet>(
          UPDATE_SET_TABLE,
          clauses.join('^'),
          [
            'sys_id',
            'name',
            'state',
            'application',
            'is_default',
            'description',
          ],
          limit ?? 20,
        );

        if (records.length === 0) {
          return textResult('No update sets match the given filters.');
        }

        const summary = records
          .map((r) => {
            const stateLabel = r.state ? resolveDisplay(r.state) : '';
            const scope = r.application ? resolveDisplay(r.application) : '';
            const isDefault =
              r.is_default && boolStr(r.is_default) ? 'yes' : 'no';
            const sysId = r.sys_id ? resolveValue(r.sys_id) : '';
            return `• ${resolveDisplay(r.name)} [${stateLabel}]  scope: ${scope}  default: ${isDefault}  (${sysId})`;
          })
          .join('\n');

        return richResult(
          `${records.length} update set(s):\n${summary}`,
          records,
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'create_update_set',
    {
      access: 'write',
      title: 'Create Update Set',
      description: [
        'Creates a new Update Set (sys_update_set) in state "in progress".',
        '',
        'Defaults the application scope to "global". Pass a sys_scope sys_id in',
        '`application` to create the set in a different scope.',
        '',
        'Set `set_as_current=true` to immediately make it the active set for the',
        'authenticated user (same effect as set_current_update_set).',
      ].join('\n'),
      inputSchema: UpdateSetCreate.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, description, application, set_as_current, ui_username }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          application: application ?? 'global',
        };
        if (description !== undefined) body.description = description;

        const created = await client.createRecord<RawUpdateSet>(
          UPDATE_SET_TABLE,
          body,
        );
        const sysId = resolveValue(created.sys_id as SnReference);

        const lines = [
          'Update set created successfully.',
          '',
          `Name:   ${name}`,
          `sys_id: ${sysId}`,
          `Scope:  ${application ?? 'global'}`,
        ];

        if (set_as_current) {
          const username = client.getUsername();
          if (!username) {
            lines.push('', `Not set as current: ${NO_NAMED_USER_MESSAGE}`);
          } else {
            await applyCurrentUpdateSet(client, username, sysId);
            lines.push(
              '',
              'This is now your active update set for changes made through this server.',
            );
            lines.push(
              ...(await alsoSetForUiUser(client, username, ui_username, sysId)),
            );
          }
        } else {
          lines.push(
            '',
            'Not set as current. To capture changes here, select it in your UI ' +
              'picker, or re-run with set_as_current=true.',
          );
        }

        lines.push('', UI_PICKER_REMINDER);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );

  registry.registerTool(
    'set_current_update_set',
    {
      access: 'write',
      title: 'Set Current Update Set',
      description: [
        'Sets the active Update Set for the authenticated user. Subsequent writes',
        'are captured in this set.',
        '',
        'Accepts the target by 32-char sys_id or by exact name.',
        '',
        'NOTE: the target should belong to your current application scope. This',
        'updates the user preference directly; it does not switch the session',
        'application scope, so picking a set from another scope may show a mismatch',
        'in the platform update-set picker.',
      ].join('\n'),
      inputSchema: SetCurrentUpdateSet.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ update_set, ui_username }) => {
      try {
        const username = client.getUsername();
        if (!username) {
          return textResult(NO_NAMED_USER_MESSAGE);
        }

        const { sysId, name } = await resolveUpdateSet(client, update_set);
        await applyCurrentUpdateSet(client, username, sysId);

        const lines = [
          'Active update set changed for changes made through this server.',
          '',
          `Name:   ${name}`,
          `sys_id: ${sysId}`,
        ];
        lines.push(
          ...(await alsoSetForUiUser(client, username, ui_username, sysId)),
        );
        lines.push('', UI_PICKER_REMINDER);

        return textResult(lines.join('\n'));
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
