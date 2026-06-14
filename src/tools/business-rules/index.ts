import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerBusinessRuleTools } from './business-rules.js';

export function registerBusinessRulesTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('business-rules');
  registerBusinessRuleTools(scoped, client);
}
