import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerClientScriptTools } from './client-scripts.js';

export function registerClientScriptsTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('client-scripts');
  registerClientScriptTools(scoped, client);
}
