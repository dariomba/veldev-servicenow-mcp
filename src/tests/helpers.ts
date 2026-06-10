import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { ToolRegistry } from '../tools/registry.js';

export async function buildTestPair(
  registerFn: (registry: ToolRegistry, client: ServiceNowClient) => void,
  mockClient: ServiceNowClient,
): Promise<{ mcpClient: Client; teardown: () => Promise<void> }> {
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test-sn', version: '0.0.0' });
  registerFn(new ToolRegistry(server), mockClient);
  const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return {
    mcpClient,
    teardown: async () => {
      await mcpClient.close();
    },
  };
}

export function firstText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content[0].text;
}
