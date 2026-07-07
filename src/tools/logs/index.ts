import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerLogTools } from './logs.js';

export function registerLogsToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('logs');
  registerLogTools(scoped, client);
}
