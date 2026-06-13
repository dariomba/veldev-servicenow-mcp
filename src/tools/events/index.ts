import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerEventQueueTools } from './event-queues.js';
import { registerEventRegistrationTools } from './event-registrations.js';
import { registerFireEventTools } from './fire-event.js';
import { registerScriptActionTools } from './script-actions.js';

export function registerEventTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const events = registry.scoped('events');
  registerEventRegistrationTools(events, client);
  registerEventQueueTools(events, client);
  registerScriptActionTools(events, client);
  registerFireEventTools(events, client);
}
