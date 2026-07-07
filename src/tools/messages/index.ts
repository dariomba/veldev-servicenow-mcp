import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerMessageTools } from './messages.js';

export function registerMessagesToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('messages');
  registerMessageTools(scoped, client);
}
