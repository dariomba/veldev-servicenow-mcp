import { z } from 'zod';

const ScriptIncludeBase = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Class name of the Script Include. Must be a valid JavaScript identifier, ' +
        "e.g. 'CatalogAjaxUtils'. Used as both the record name and class name in the script.",
    ),
  script: z
    .string()
    .min(1)
    .describe(
      'Full JavaScript body of the Script Include. For client-callable scripts, ' +
        'must define a class that extends AbstractAjaxProcessor.',
    ),
  client_callable: z
    .boolean()
    .optional()
    .describe(
      'Set to true if this Script Include will be called from the client via GlideAjax.',
    ),
  access: z
    .enum(['public', 'package_private'])
    .optional()
    .describe(
      "'public' makes the Script Include callable from any scope (required for GlideAjax). " +
        "'package_private' restricts it to the same application scope.",
    ),
  description: z
    .string()
    .optional()
    .describe('Optional description of what this Script Include does.'),
  active: z
    .boolean()
    .optional()
    .describe('Whether the Script Include is active.'),
});

export const ScriptIncludeCreate = ScriptIncludeBase.extend({
  client_callable: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Set to true if this Script Include will be called from the client via GlideAjax. ' +
        'Defaults to false.',
    ),
  access: z
    .enum(['public', 'package_private'])
    .optional()
    .default('public')
    .describe(
      "'public' makes the Script Include callable from any scope (required for GlideAjax). " +
        "'package_private' restricts it to the same application scope. Defaults to 'public'.",
    ),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the Script Include is active. Defaults to true.'),
});

export const ScriptIncludeUpdate = ScriptIncludeBase.partial().extend({
  sys_id: z
    .string()
    .min(1)
    .describe('sys_id of the script include record to update.'),
});
