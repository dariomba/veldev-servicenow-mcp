import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerEmailScriptTools } from './email-scripts.js';
import { registerNotificationTools } from './notifications.js';

export function registerNotificationsToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('notifications');
  registerNotificationTools(scoped, client);
  registerEmailScriptTools(scoped, client);
}
