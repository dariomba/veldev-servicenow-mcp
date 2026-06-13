import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerCatalogClientScriptTools } from './client-scripts.js';
import { registerCatalogReadTools } from './read.js';
import { registerRecordProducerTools } from './record-producers.js';
import { registerUiPolicyTools } from './ui-policies.js';
import { registerCatalogWriteTools } from './write.js';

export function registerCatalogTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const catalog = registry.scoped('catalog');
  registerCatalogReadTools(catalog, client);
  registerCatalogWriteTools(catalog, client);
  registerRecordProducerTools(catalog, client);
  registerUiPolicyTools(catalog, client);
  registerCatalogClientScriptTools(catalog, client);
}
