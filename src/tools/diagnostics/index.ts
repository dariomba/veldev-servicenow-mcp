import type { ServiceNowClient } from '../../clients/servicenow.js';
import type { ToolRegistry } from '../registry.js';
import { registerBackgroundScriptTools } from './background-scripts.js';
import { registerFixScriptTools } from './fix-scripts.js';

export function registerDiagnosticsTools(
  registry: ToolRegistry,
  client: ServiceNowClient,
): void {
  const diagnostics = registry.scoped('diagnostics');
  registerBackgroundScriptTools(diagnostics, client);
  registerFixScriptTools(diagnostics, client);
}
