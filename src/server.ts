import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from './clients/servicenow.js';
import { registerAtfTools } from './tools/atf/index.js';
import { registerBusinessRulesTools } from './tools/business-rules/index.js';
import { registerCatalogTools } from './tools/catalog/index.js';
import { registerClientScriptsTools } from './tools/client-scripts/index.js';
import { registerDiagnosticsTools } from './tools/diagnostics/index.js';
import { registerEventTools } from './tools/events/index.js';
import { registerRecordTools } from './tools/records/index.js';
import { ToolRegistry, type ToolRegistryOptions } from './tools/registry.js';
import { registerScriptIncludesTools } from './tools/script-includes/index.js';
import { registerUpdateSetTools } from './tools/update-sets/index.js';

export function buildServer(
  snClient: ServiceNowClient,
  registryOptions?: ToolRegistryOptions,
): {
  server: McpServer;
  registry: ToolRegistry;
} {
  const server = new McpServer({ name: 'servicenow-mcp', version: '0.1.0' });
  const registry = new ToolRegistry(server, registryOptions);

  registerCatalogTools(registry, snClient);
  registerBusinessRulesTools(registry, snClient);
  registerClientScriptsTools(registry, snClient);
  registerScriptIncludesTools(registry, snClient);
  registerUpdateSetTools(registry, snClient);
  registerDiagnosticsTools(registry, snClient);
  registerRecordTools(registry, snClient);
  registerAtfTools(registry, snClient);
  registerEventTools(registry, snClient);

  return { server, registry };
}
