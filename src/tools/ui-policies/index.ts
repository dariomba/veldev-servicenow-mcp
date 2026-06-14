import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerUiPolicyTools } from './ui-policies.js';
import { registerUiPolicyActionTools } from './ui-policy-actions.js';
import { registerUiPolicyRlActionTools } from './ui-policy-rl-actions.js';

export function registerUiPolicyToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const uiPolicies = registry.scoped('ui-policies');
  registerUiPolicyTools(uiPolicies, client);
  registerUiPolicyActionTools(uiPolicies, client);
  registerUiPolicyRlActionTools(uiPolicies, client);
}
