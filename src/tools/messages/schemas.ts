import { z } from 'zod';

// ── UI / System Message (sys_ui_message) ────────────────────────────────────
//
// A UI message is a localizable piece of text looked up at runtime by `key`:
//   • server-side  — gs.getMessage('key') (optionally with substitution args)
//   • client-side  — getMessage('key')
//
// Localization is per-language: the SAME key exists once PER language, each in
// its own record. gs.getMessage resolves the key for the current session's
// language, falling back to the message text itself when no record matches.
// So `key`+`language` together identify a record — that pair is the natural
// key and the idempotency key for these tools.
//
//   • key      — the lookup key. Often the English source text itself, but can
//                be any stable token.
//   • message  — the translated text returned for that key+language.
//   • language — ISO language code (e.g. "en", "es", "fr", "de", "ja").
//
// Field shapes mirror the sys_ui_message dictionary.

const MessageBase = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    .describe(
      'The message key looked up at runtime with gs.getMessage(key) / ' +
        'getMessage(key). Often the English source string itself, but can be any ' +
        'stable token. Combined with `language` it identifies the record.',
    ),
  message: z
    .string()
    .max(8000)
    .optional()
    .describe(
      'The text returned for this key in this language. May contain {0}, {1}, … ' +
        'placeholders substituted by gs.getMessage(key, [args]).',
    ),
  language: z
    .string()
    .max(40)
    .optional()
    .describe(
      'ISO language code for this translation, e.g. "en", "es", "fr", "de", ' +
        '"ja". The same key has a separate record per language. Defaults to "en".',
    ),
});

/**
 * Every writable sys_ui_message column, derived from the base schema so the
 * schema stays the single source of truth — the create/update handlers iterate
 * this to build the request body instead of re-listing field names. sys_id is
 * intentionally absent: it addresses the record, it is never written into it.
 */
export const MESSAGE_FIELDS = Object.keys(MessageBase.shape);

/** Update patches by key+language; neither is re-written when locating it. */
export const MESSAGE_UPDATE_FIELDS = MESSAGE_FIELDS.filter(
  (f) => f !== 'key' && f !== 'language',
);

export const MessageCreate = MessageBase.extend({
  message: z
    .string()
    .min(1)
    .describe('The text returned for this key in this language. Required.'),
  language: MessageBase.shape.language
    .default('en')
    .describe('ISO language code. Defaults to "en".'),
});

export const MessageUpdate = MessageBase.extend({
  key: MessageBase.shape.key.describe(
    'Key of the message to update — used with `language` to locate the record.',
  ),
  language: MessageBase.shape.language
    .default('en')
    .describe(
      'ISO language code of the translation to update. Defaults to "en". ' +
        'The same key in another language is a different record.',
    ),
});

export const MessageList = z.object({
  key_contains: z
    .string()
    .optional()
    .describe('Filter to messages whose key contains this text.'),
  language: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Filter to a single language code, e.g. "en". Omit to return all ' +
        'languages.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of messages to return (1–100). Defaults to 50.'),
});

export const MessageGet = z.object({
  key: z.string().min(1).describe('Exact message key to read.'),
  language: z
    .string()
    .max(40)
    .optional()
    .default('en')
    .describe(
      'ISO language code of the translation to read. Defaults to "en".',
    ),
});
