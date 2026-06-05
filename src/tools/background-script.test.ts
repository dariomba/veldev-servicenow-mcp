import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerBackgroundScriptTools } from '../tools/background-script.js';

const TRIGGER_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const TRIGGER_NAME = 'MCP_Script_1717600000000';
const NEXT_ACTION = '05/06/2026 10:00:01';

function buildMockClient(): ServiceNowClient {
  return {
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue({
      success: true,
      trigger_sys_id: TRIGGER_SYS_ID,
      trigger_name: TRIGGER_NAME,
      next_action: NEXT_ACTION,
      message: `Script scheduled to run at ${NEXT_ACTION} (UTC).`,
    }),
  } as unknown as ServiceNowClient;
}

describe('background-script tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerBackgroundScriptTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('execute_background_script', () => {
    it('returns trigger_sys_id, trigger_name, and next_action on success', async () => {
      const result = await mcpClient.callTool({
        name: 'execute_background_script',
        arguments: { script: 'gs.info("hello");' },
      });
      const text = firstText(result);
      expect(text).toContain('scheduled successfully');
      expect(text).toContain(TRIGGER_SYS_ID);
      expect(text).toContain(TRIGGER_NAME);
      expect(text).toContain(NEXT_ACTION);
      expect(result.isError).toBeFalsy();
    });

    it('calls executeBackgroundScriptTrigger with the provided script', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(
        registerBackgroundScriptTools,
        mockClient,
      );
      try {
        const script = 'var gr = new GlideRecord("incident"); gr.query();';
        await pair.mcpClient.callTool({
          name: 'execute_background_script',
          arguments: { script },
        });
        expect(mockClient.executeBackgroundScriptTrigger).toHaveBeenCalledWith(
          script,
        );
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        executeBackgroundScriptTrigger: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              403,
              'Forbidden',
              'insufficient privileges',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerBackgroundScriptTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'execute_background_script',
          arguments: { script: 'gs.info("x");' },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('403');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects empty script with Zod validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'execute_background_script',
        arguments: { script: '' },
      });
      expect(result.isError).toBe(true);
    });
  });
});
