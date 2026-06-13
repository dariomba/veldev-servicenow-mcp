import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerBusinessRuleTools } from './business-rules.js';
import { registerScriptIncludeTools } from './script-includes.js';

export function registerScriptTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scripts = registry.scoped('scripts');
  registerScriptIncludeTools(scripts, client);
  registerBusinessRuleTools(scripts, client);
}
