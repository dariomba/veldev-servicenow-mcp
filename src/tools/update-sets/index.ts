import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerUpdateSetTools as registerTools } from './update-sets.js';

export function registerUpdateSetTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registerTools(registry.scoped('update-sets'), client);
}
