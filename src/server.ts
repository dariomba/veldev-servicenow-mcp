import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from './clients/servicenow.js';
import { registerAtfTools } from './tools/atf.js';
import { registerBackgroundScriptTools } from './tools/background-script.js';
import { registerBusinessRuleTools } from './tools/business-rule.js';
import { registerCatalogClientScriptTools } from './tools/catalog-client-script.js';
import { registerCatalogReadTools } from './tools/catalog-read.js';
import { registerCatalogWriteTools } from './tools/catalog-write.js';
import { registerFixScriptTools } from './tools/fix-script.js';
import { registerRecordProducerTools } from './tools/record-producer.js';
import { ToolRegistry, type ToolRegistryOptions } from './tools/registry.js';
import { registerScheduledJobTools } from './tools/scheduled-job.js';
import { registerScriptIncludeTools } from './tools/script-include.js';
import { registerTableCrudTools } from './tools/table-crud.js';
import { registerUiPolicyTools } from './tools/ui-policy-write.js';
import { registerUpdateSetTools } from './tools/update-sets.js';

export function buildServer(
  snClient: ServiceNowClient,
  registryOptions?: ToolRegistryOptions,
): {
  server: McpServer;
  registry: ToolRegistry;
} {
  const server = new McpServer({ name: 'servicenow-mcp', version: '0.1.0' });
  const registry = new ToolRegistry(server, registryOptions);

  registerCatalogReadTools(registry, snClient);
  registerCatalogWriteTools(registry, snClient);
  registerRecordProducerTools(registry, snClient);
  registerUiPolicyTools(registry, snClient);
  registerCatalogClientScriptTools(registry, snClient);
  registerScriptIncludeTools(registry, snClient);
  registerBusinessRuleTools(registry, snClient);
  registerUpdateSetTools(registry, snClient);
  registerBackgroundScriptTools(registry, snClient);
  registerFixScriptTools(registry, snClient);
  registerTableCrudTools(registry, snClient);
  registerAtfTools(registry, snClient);
  registerScheduledJobTools(registry, snClient);

  return { server, registry };
}
