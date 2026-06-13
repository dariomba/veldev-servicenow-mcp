import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerFireEventTools } from './fire-event.js';

const RECORD_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';

function buildMockClient(): ServiceNowClient {
  return {
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue({
      success: true,
      trigger_sys_id: 'trig123',
      trigger_name: 'MCP_Script_1',
      next_action: '2026-06-13 00:00:01',
    }),
  } as unknown as ServiceNowClient;
}

describe('fire_event tool (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;
  let mockClient: ServiceNowClient;

  beforeEach(async () => {
    mockClient = buildMockClient();
    const pair = await buildTestPair(registerFireEventTools, mockClient);
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  it('fires a bare event via gs.eventQueue with null record', async () => {
    const result = await mcpClient.callTool({
      name: 'fire_event',
      arguments: { event_name: 'x_acme.thing.done', parm1: 'hi' },
    });
    expect(firstText(result)).toContain('Event fire requested');
    const script = (
      mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
    ).mock.calls[0][0] as string;
    expect(script).toContain('var gr = null;');
    expect(script).toContain(
      'gs.eventQueue("x_acme.thing.done", gr, "hi", "")',
    );
    expect(script).not.toContain('new GlideRecord');
  });

  it('attaches a record when table + sys_id are provided', async () => {
    await mcpClient.callTool({
      name: 'fire_event',
      arguments: {
        event_name: 'x_acme.thing.done',
        record_table: 'incident',
        record_sys_id: RECORD_SYS_ID,
      },
    });
    const script = (
      mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
    ).mock.calls[0][0] as string;
    expect(script).toContain('new GlideRecord("incident")');
    expect(script).toContain(`_g.get("${RECORD_SYS_ID}")`);
  });

  it('errors when only one of table / sys_id is given', async () => {
    const result = await mcpClient.callTool({
      name: 'fire_event',
      arguments: { event_name: 'x_acme.thing.done', record_table: 'incident' },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('must be provided together');
    expect(mockClient.executeBackgroundScriptTrigger).not.toHaveBeenCalled();
  });

  it('errors on an invalid record sys_id', async () => {
    const result = await mcpClient.callTool({
      name: 'fire_event',
      arguments: {
        event_name: 'x_acme.thing.done',
        record_table: 'incident',
        record_sys_id: 'not-valid',
      },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('not a valid');
  });
});
