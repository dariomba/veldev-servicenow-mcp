import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerUiActionTools } from './ui-actions.js';

export function registerUiActionsToolset(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const scoped = registry.scoped('ui-actions');
  registerUiActionTools(scoped, client);
}
