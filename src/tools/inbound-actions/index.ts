import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerInboundActionTools } from './inbound-actions.js';

export function registerInboundActionsToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('inbound-actions');
  registerInboundActionTools(scoped, client);
}
