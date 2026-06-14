import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerScriptIncludeTools } from './script-includes.js';

export function registerScriptIncludesTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('script-includes');
  registerScriptIncludeTools(scoped, client);
}
