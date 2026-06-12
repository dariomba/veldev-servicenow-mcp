import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerTableCrudTools } from './table-crud.js';

export function registerRecordTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  registerTableCrudTools(registry, client);
}
