import { z } from 'zod';

// ── System Property (sys_properties) ────────────────────────────────────────
//
// A system property is a named configuration value read at runtime with
// gs.getProperty('name') (server-side) or via the property's name in client
// code. `name` is the natural key — there is one record per property name.
//
//   • value        — the stored value, always text. ServiceNow interprets it
//                    according to `type` only at read time; the column itself
//                    is a string, so "123"/"true" are stored as text.
//   • type         — how callers are expected to interpret `value` (string,
//                    integer, boolean, password, …). It does NOT coerce or
//                    validate the stored text — that is the caller's job, which
//                    is why these tools warn on an integer/boolean mismatch.
//   • is_private   — when true the property is excluded from update sets (stays
//                    instance-local; not migrated between instances).
//   • ignore_cache — when true a change does NOT flush the property cache, so
//                    nodes may serve the old value until the next cache cycle.
//   • read_roles / write_roles — comma-separated role names gating who may read
//                    or write the property through the UI/API.
//
// Field shapes mirror the sys_properties dictionary.

const PropertyBase = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe(
      'Property name — the natural key, e.g. "glide.ui.rich_text_editor" or ' +
        '"x_myapp.feature.enabled". Read at runtime with gs.getProperty(name). ' +
        'One record per name; reused as the idempotency key.',
    ),
  value: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'The stored value, as text. Booleans are "true"/"false", integers are ' +
        'the digits as a string (e.g. "30"). Always a string in storage — `type` ' +
        'only tells callers how to interpret it, it does not coerce or validate it.',
    ),
  // Values taken verbatim from the live sys_properties.type choice list.
  type: z
    .enum([
      'string',
      'short_string',
      'integer',
      'boolean',
      'password',
      'password2',
      'color',
      'choicelist',
      'image',
      'uploaded_image',
      'date_format',
      'time_format',
      'timezone',
    ])
    .describe(
      'How `value` is meant to be interpreted by callers (from the live ' +
        'sys_properties type choice list):\n' +
        '• string — plain text (default).\n' +
        '• short_string — text of 40 characters or less.\n' +
        '• integer — a whole number stored as text, e.g. "30".\n' +
        '• boolean — "true" or "false".\n' +
        '• password — one-way encrypted secret.\n' +
        '• password2 — two-way encrypted secret.\n' +
        '• color — a colour value.\n' +
        '• choicelist — value constrained to the `choices` list.\n' +
        '• image / uploaded_image — an image reference.\n' +
        '• date_format / time_format / timezone — a date, time, or timezone format.\n' +
        'This is metadata only — it does not coerce or validate `value`.',
    ),
  description: z
    .string()
    .max(512)
    .optional()
    .describe('Free-text description of what the property controls.'),
  suffix: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Optional category/suffix used to group properties on the System ' +
        'Properties UI. Usually left empty.',
    ),
  is_private: z
    .boolean()
    .optional()
    .describe(
      'When true the property is private: excluded from update sets so it stays ' +
        'instance-local and is not migrated between instances. Default false.',
    ),
  ignore_cache: z
    .boolean()
    .optional()
    .describe(
      'When true, changing the property does NOT flush the property cache — ' +
        'nodes may serve the stale value until the next cache cycle. Default false.',
    ),
  read_roles: z
    .string()
    .optional()
    .describe(
      'Comma-separated role names required to read the property (e.g. "admin"). ' +
        'Empty means no read restriction.',
    ),
  write_roles: z
    .string()
    .optional()
    .describe(
      'Comma-separated role names required to write the property. Empty means ' +
        'no write restriction beyond the table ACLs.',
    ),
});

/**
 * Every writable sys_properties column, derived from the base schema so the
 * schema stays the single source of truth — the create/update handlers iterate
 * this to build the request body instead of re-listing field names. sys_id is
 * intentionally absent: it addresses the record, it is never written into it.
 */
export const PROPERTY_FIELDS = Object.keys(PropertyBase.shape);

/** Update patches by name (the natural key); name itself is never re-written. */
export const PROPERTY_UPDATE_FIELDS = PROPERTY_FIELDS.filter(
  (f) => f !== 'name',
);

export const PropertyCreate = PropertyBase.extend({
  type: PropertyBase.shape.type
    .default('string')
    .describe('How `value` is interpreted. Defaults to "string".'),
  is_private: z
    .boolean()
    .optional()
    .default(false)
    .describe('Defaults to false.'),
  ignore_cache: z
    .boolean()
    .optional()
    .default(false)
    .describe('Defaults to false.'),
});

export const PropertyUpdate = PropertyBase.partial().extend({
  name: PropertyBase.shape.name.describe(
    'Name of the property to update — the natural key used to locate the ' +
      'record. The name itself is not changed.',
  ),
});

export const PropertyList = z.object({
  name_contains: z
    .string()
    .optional()
    .describe(
      'Filter to properties whose name contains this text, e.g. "glide.ui" ' +
        'or an application scope prefix.',
    ),
  type: PropertyBase.shape.type
    .optional()
    .describe('Filter by property type (string/integer/boolean/…).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe(
      'Maximum number of properties to return (1–100). Defaults to 50.',
    ),
});

export const PropertyGet = z.object({
  name: z
    .string()
    .min(1)
    .describe('Exact property name to read, e.g. "glide.ui.rich_text_editor".'),
});
