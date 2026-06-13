import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerAtfTools as registerTools } from './atf.js';

export function registerAtfTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registerTools(registry.scoped('atf'), client);
}
