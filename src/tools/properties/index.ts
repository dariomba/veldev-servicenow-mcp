import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerPropertyTools } from './properties.js';

export function registerPropertiesToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('properties');
  registerPropertyTools(scoped, client);
}
