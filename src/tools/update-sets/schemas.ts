import { z } from 'zod';

// ── Update Sets ──

export const UpdateSetList = z.object({
  state: z
    .enum(['in progress', 'complete', 'ignore'])
    .optional()
    .describe(
      'Filter by state. Defaults to "in progress" when omitted (the sets you can still add changes to).',
    ),
  application: z
    .string()
    .optional()
    .describe(
      'Filter by application scope — the literal "global" for the Global scope, or a sys_scope sys_id.',
    ),
  name_contains: z
    .string()
    .optional()
    .describe('Case-insensitive substring match on the update set name.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Maximum number of update sets to return (1–100). Defaults to 20.',
    ),
});

export const UpdateSetCreate = z.object({
  name: z.string().min(1).describe('Name of the new update set.'),
  description: z
    .string()
    .optional()
    .describe('Plain-text description of what the update set covers.'),
  application: z
    .string()
    .optional()
    .default('global')
    .describe(
      'Application scope — the literal "global" (default) or a sys_scope sys_id.',
    ),
  set_as_current: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, also make this the active update set for the authenticated user.',
    ),
  ui_username: z
    .string()
    .optional()
    .describe(
      'Optional ServiceNow username to ALSO set this update set as current for, so it ' +
        "shows as the active set in THAT user's ServiceNow UI. Only applies when " +
        'set_as_current=true. The set is always made current for the authenticated API ' +
        'user (that is what captures changes made through this server); this extra sync ' +
        'only affects UI visibility and takes effect after the user reloads the page / ' +
        'starts a new session — it cannot move an already-open update set picker. Use it ' +
        'when the server connects as a service account different from your own login.',
    ),
});

export const SetCurrentUpdateSet = z.object({
  update_set: z
    .string()
    .min(1)
    .describe(
      'The update set to activate — a 32-char sys_id, or an exact update set name.',
    ),
  ui_username: z
    .string()
    .optional()
    .describe(
      'Optional ServiceNow username to ALSO set this update set as current for, so it ' +
        "shows as the active set in THAT user's ServiceNow UI. The set is always made " +
        'current for the authenticated API user (that is what captures changes made ' +
        'through this server); this extra sync only affects UI visibility and takes ' +
        'effect after the user reloads the page / starts a new session — it cannot move ' +
        'an already-open update set picker. Use it when the server connects as a service ' +
        'account different from your own login.',
    ),
});
