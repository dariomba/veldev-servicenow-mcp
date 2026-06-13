import { z } from 'zod';
import { type ServiceNowClient, SnApiError } from '../../clients/servicenow.js';
import type { SnReference } from '../../types/servicenow.js';
import {
  errText,
  handleError,
  isSysId,
  requireSysId,
  resolveValue,
  textResult,
} from '../helpers.js';
import type { ToolRegistrar } from '../registry.js';

export const TRANSLATION_CONFIG = {
  enabled: false,
  languages: ['es', 'en'],
} as const;

// Routing determined from sys_dictionary query on the instance:
// Translated Field  → sys_translated     (question_text, tooltip, help_tag)
// Translated Text   → sys_translated_text (name, short_description, description, conversational_label, help_text, instructions)
const ITEM_FIELD_TABLE: Record<
  string,
  'sys_translated' | 'sys_translated_text'
> = {
  name: 'sys_translated_text',
  short_description: 'sys_translated_text',
  description: 'sys_translated_text',
};

const VARIABLE_FIELD_TABLE: Record<
  string,
  'sys_translated' | 'sys_translated_text'
> = {
  question_text: 'sys_translated',
  tooltip: 'sys_translated',
  help_tag: 'sys_translated',
  example_text: 'sys_translated',
  help_text: 'sys_translated_text',
  instructions: 'sys_translated_text',
  conversational_label: 'sys_translated_text',
};

const ChoiceTranslation = z.object({
  value: z
    .string()
    .min(1)
    .describe(
      "The original 'value' of the choice (e.g. 'iphone', 'samsung_galaxy').",
    ),
  label: z.string().min(1).describe('Translated display text for this choice.'),
});

const VariableTranslation = z.object({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the variable (item_option_new).'),
  name: z
    .string()
    .min(1)
    .describe(
      "Internal name of the variable (item_option_new.name). Used as the 'value' key in sys_translated records.",
    ),
  question_text: z.string().optional(),
  example_text: z.string().optional(),
  conversational_label: z.string().optional(),
  tooltip: z.string().optional(),
  help_tag: z.string().optional(),
  help_text: z.string().optional(),
  instructions: z.string().optional(),
  choices: z
    .array(ChoiceTranslation)
    .optional()
    .describe(
      'Translated choices for Select Box (type=5) or Multiple Choice (type=3) variables. ' +
        'Skip for Yes/No (type=1) — ServiceNow translates those automatically via language packs.',
    ),
});

const LanguageBlock = z.object({
  item: z
    .object({
      name: z.string().optional(),
      short_description: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  variables: z.array(VariableTranslation).optional(),
});

// sys_translated uses name/element/id/value/label
// sys_translated_text uses tablename/fieldname/documentkey/value
function buildTranslationPayload(
  targetTable: 'sys_translated' | 'sys_translated_text',
  tablename: string,
  fieldname: string,
  recordSysId: string,
  language: string,
  translatedText: string,
  baseFieldValue?: string,
): Record<string, string> {
  if (targetTable === 'sys_translated') {
    return {
      name: tablename,
      element: fieldname,
      value: baseFieldValue ?? recordSysId, // current base-lang field value (e.g. "Device Type")
      language,
      label: translatedText,
    };
  }
  return {
    tablename,
    fieldname,
    documentkey: recordSysId,
    language,
    value: translatedText,
  };
}

async function upsertTranslation(
  client: ServiceNowClient,
  table: 'sys_translated' | 'sys_translated_text',
  query: string,
  payload: Record<string, string>,
): Promise<void> {
  try {
    await client.createRecord(table, payload);
  } catch (createErr) {
    // Auth/permission failures are terminal — don't attempt the read fallback
    if (
      createErr instanceof SnApiError &&
      (createErr.status === 401 || createErr.status === 403)
    ) {
      throw createErr;
    }
    // Anything else is likely a duplicate key violation — find the existing record and update it
    try {
      const existing = await client.listRecords<{ sys_id: SnReference }>(
        table,
        query,
        ['sys_id'],
        1,
      );
      if (existing.length > 0) {
        await client.updateRecord(
          table,
          resolveValue(existing[0].sys_id),
          payload,
        );
        return;
      }
    } catch {
      // Table is write-only (read blocked) — re-throw the original create error
    }
    throw createErr;
  }
}

export function registerCatalogTranslationTools(
  registry: ToolRegistrar,
  client: ServiceNowClient,
): void {
  registry.registerTool(
    'translate_catalog_item',
    {
      access: 'write',
      title: 'Translate Catalog Item',
      description: [
        'Writes pre-translated text for a catalog item and its variables to ServiceNow.',
        '',
        `TRANSLATION_CONFIG: enabled=${TRANSLATION_CONFIG.enabled}.`,
        'Active languages are determined at call time by querying sys_language?active=true on the instance.',
        '',
        'WHEN TO USE: call this automatically after create_catalog_item and',
        'batch_create_catalog_variables. Translate all non-empty text fields yourself',
        'into all active languages returned by sys_language?active=true before calling.',
        "Skip only if the user explicitly says 'don't translate', 'skip translation',",
        'or specifies different languages. Never ask unprompted — infer from context.',
        '',
        'Table routing (per field):',
        '  sc_cat_item  name, short_description, description → sys_translated_text',
        '  item_option_new  question_text, tooltip, help_tag, example_text → sys_translated',
        "    (name='question', element=<fieldname>, id=<varSysId>)",
        '  item_option_new  conversational_label, help_text, instructions → sys_translated_text',
        '  question_choice  text → sys_translated',
        "    (name='question_choice', element='text', value=<choiceValue>, label=<translation>)",
        '',
        'CHOICES: Only translate choices for type=5 (Select Box) and type=3 (Multiple Choice).',
        'Skip Yes/No (type=1) — ServiceNow translates those automatically via language packs.',
        '',
        'Only include fields with non-empty translations. Preserve any HTML in values.',
      ].join('\n'),
      inputSchema: {
        catalog_item_sys_id: z
          .string()
          .min(1)
          .describe(
            'sys_id of the catalog item (sc_cat_item) whose translations to write.',
          ),
        translations: z
          .record(z.string(), LanguageBlock)
          .describe(
            'Map of ISO language code → translated content. E.g. {"es": {"item": {...}, "variables": [...]}}.' +
              ' Only include fields with non-empty values.',
          ),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ catalog_item_sys_id, translations }) => {
      try {
        if (!TRANSLATION_CONFIG.enabled) {
          return textResult(
            'Translation is disabled in TRANSLATION_CONFIG — skipped.',
          );
        }

        const activeLanguageRecords = await client.listRecords<{
          id: SnReference;
        }>('sys_language', 'active=true', ['id'], 50);
        const activeLanguages = activeLanguageRecords
          .map((r) => r.id.value)
          .filter(Boolean);

        const err = requireSysId(catalog_item_sys_id, 'catalog item sys_id');
        if (err) return errText(err);

        // Pre-fetch base field values for variables that use sys_translated.
        // sys_translated.value must be the current base-language field value (e.g. "Device Type"),
        // not the internal name or sys_id.
        const sysTranslatedVarFields = [
          'question_text',
          'tooltip',
          'help_tag',
          'example_text',
        ];
        const varSysIdsToFetch = new Set<string>();
        for (const data of Object.values(translations)) {
          for (const variable of data.variables ?? []) {
            if (!isSysId(variable.sys_id)) continue;
            if (
              variable.question_text ||
              variable.tooltip ||
              variable.help_tag ||
              variable.example_text
            ) {
              varSysIdsToFetch.add(variable.sys_id);
            }
          }
        }
        const varBaseFieldValues = new Map<
          string,
          Record<string, SnReference>
        >();
        await Promise.all(
          [...varSysIdsToFetch].map(async (sysId) => {
            const record = await client.getRecord<Record<string, SnReference>>(
              'item_option_new',
              sysId,
              sysTranslatedVarFields,
            );
            varBaseFieldValues.set(sysId, record);
          }),
        );

        const tasks: Promise<unknown>[] = [];

        for (const [lang, data] of Object.entries(translations)) {
          // sc_cat_item fields → sys_translated_text
          if (data.item) {
            for (const [fieldname, value] of Object.entries(data.item)) {
              if (!value) continue;
              const itemTable =
                ITEM_FIELD_TABLE[fieldname] ?? 'sys_translated_text';
              const payload = buildTranslationPayload(
                itemTable,
                'sc_cat_item',
                fieldname,
                catalog_item_sys_id,
                lang,
                value,
              );
              const query = `tablename=sc_cat_item^fieldname=${fieldname}^documentkey=${catalog_item_sys_id}^language=${lang}`;
              tasks.push(upsertTranslation(client, itemTable, query, payload));
            }
          }

          // item_option_new fields + choices
          if (data.variables) {
            for (const variable of data.variables) {
              const {
                sys_id: varSysId,
                name: _varName,
                choices,
                ...fields
              } = variable;

              // Validate sys_id
              if (!isSysId(varSysId)) {
                return errText(
                  `Variable translation skipped: sys_id "${varSysId}" is not valid. ` +
                    `Ensure batch_create_catalog_variables has completed and sys_ids are passed correctly.`,
                );
              }

              const varBaseRecord = varBaseFieldValues.get(varSysId);

              // Variable text fields (question_text, tooltip, etc.)
              for (const [fieldname, translatedText] of Object.entries(
                fields,
              )) {
                if (!translatedText) continue;
                const table =
                  VARIABLE_FIELD_TABLE[fieldname] ?? 'sys_translated_text';
                const baseFieldValue =
                  table === 'sys_translated'
                    ? varBaseRecord?.[fieldname]?.value
                    : undefined;
                const payload = buildTranslationPayload(
                  table,
                  'question',
                  fieldname,
                  varSysId,
                  lang,
                  translatedText,
                  baseFieldValue,
                );
                const query =
                  table === 'sys_translated'
                    ? `name=question^element=${fieldname}^value=${baseFieldValue ?? varSysId}^language=${lang}`
                    : `tablename=item_option_new^fieldname=${fieldname}^documentkey=${varSysId}^language=${lang}`;
                tasks.push(upsertTranslation(client, table, query, payload));
              }

              // Choices → sys_translated (name=question_choice, element=text, value=<choiceValue>)
              if (choices?.length) {
                for (const choice of choices) {
                  if (!choice.label || !choice.value) continue;
                  const payload = {
                    name: 'question_choice',
                    element: 'text',
                    value: choice.value,
                    language: lang,
                    label: choice.label,
                  };
                  const query = `name=question_choice^element=text^value=${choice.value}^language=${lang}`;
                  tasks.push(
                    upsertTranslation(client, 'sys_translated', query, payload),
                  );
                }
              }
            }
          }
        }

        const results = await Promise.allSettled(tasks);

        const failures = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        const succeeded = results.length - failures.length;

        if (failures.length > 0) {
          const first = failures[0].reason;
          const is403 = first instanceof SnApiError && first.status === 403;
          const hint = is403
            ? '\n\nLikely cause: the target language is not installed in this ServiceNow instance, ' +
              'Check System Definition → Languages and confirm the language is active.'
            : '';
          return errText(
            `Translation partially failed: ${succeeded}/${results.length} record(s) written, ` +
              `${failures.length} failed.\n\n` +
              `First error: ${first instanceof Error ? first.message : String(first)}` +
              hint,
          );
        }

        const langLines = Object.entries(translations).map(([lang, data]) => {
          const itemCount = Object.values(data.item ?? {}).filter(
            Boolean,
          ).length;
          const varFieldCount = (data.variables ?? []).reduce(
            (acc, { sys_id: _, choices: _c, ...fields }) => {
              return acc + Object.values(fields).filter(Boolean).length;
            },
            0,
          );
          const choiceCount = (data.variables ?? []).reduce(
            (acc, { choices }) => {
              return acc + (choices?.length ?? 0);
            },
            0,
          );
          return `  ${lang}: ${itemCount} item field(s), ${varFieldCount} variable field(s), ${choiceCount} choice(s)`;
        });

        return textResult(
          [
            `Catalog item translations written.`,
            ``,
            `Catalog item:     ${catalog_item_sys_id}`,
            `Languages written: ${Object.keys(translations).join(', ')}`,
            `Active languages:  ${activeLanguages.join(', ')}`,
            ``,
            ...langLines,
          ].join('\n'),
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
