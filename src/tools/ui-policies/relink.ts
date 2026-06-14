import type { ServiceNowClient } from '../../clients/servicenow.js';

/**
 * The ui_policy reference on the policy-action tables (sys_ui_policy_action and
 * sys_ui_policy_rl_action) is not persisted on the REST insert/update path —
 * the action lands orphaned (ui_policy empty). A server-side GlideRecord update
 * sets it correctly, so re-link via a single background script, mirroring the
 * catalog UI policy tools. Batched: one script re-links every action at once.
 */
export async function relinkPolicies(
  client: ServiceNowClient,
  table: string,
  links: ReadonlyArray<{ action: string; policy: string }>,
): Promise<void> {
  if (links.length === 0) return;

  const literal = links
    .map((l) => `{a:'${l.action}',p:'${l.policy}'}`)
    .join(',');
  const script = `var links = [${literal}];
for (var i = 0; i < links.length; i++) {
  var gr = new GlideRecord('${table}');
  if (gr.get(links[i].a)) {
    gr.setValue('ui_policy', links[i].p);
    gr.update();
  }
}`;
  await client.executeBackgroundScriptTrigger(script);
}
