import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerMessageTools } from './messages.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

function ref(value: string) {
  return { value, display_value: value };
}

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ sys_id: ref(NEW_SYS_ID) }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getInstanceUrl: vi.fn().mockReturnValue('https://pdi.service-now.com'),
  } as unknown as ServiceNowClient;
}

function withListResults(rows: unknown[]): ServiceNowClient {
  return {
    ...buildMockClient(),
    listRecords: vi.fn().mockResolvedValue(rows),
  } as unknown as ServiceNowClient;
}

describe('message tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerMessageTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_message', () => {
    it('creates a message and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_message',
        arguments: { key: 'Hello there', message: 'Hola' },
      });
      const text = firstText(result);
      expect(text).toContain('created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('Hello there');
      expect(result.isError).toBeFalsy();
    });

    it('defaults language to en and serialises the body', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerMessageTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_message',
          arguments: { key: 'Submit', message: 'Submit' },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_ui_message',
          expect.objectContaining({
            key: 'Submit',
            message: 'Submit',
            language: 'en',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('includes the per-language note', async () => {
      const result = await mcpClient.callTool({
        name: 'create_message',
        arguments: { key: 'Greeting', message: 'Bonjour', language: 'fr' },
      });
      const text = firstText(result);
      expect(text).toContain('per-language');
      expect(text).toContain('fr');
    });

    it('returns existing record without creating when key+language exists', async () => {
      const idempotentClient = withListResults([
        { sys_id: ref(EXISTING_SYS_ID) },
      ]);
      const pair = await buildTestPair(registerMessageTools, idempotentClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_message',
          arguments: { key: 'Hello there', message: 'Hola', language: 'es' },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('surfaces SnApiError as isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(500, 'Internal Server Error', 'fault', 'https://x'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerMessageTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_message',
          arguments: { key: 'X', message: 'Y' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_message', () => {
    it('locates by key+language, patches message, lists updated fields', async () => {
      const mockClient = withListResults([{ sys_id: ref(EXISTING_SYS_ID) }]);
      const pair = await buildTestPair(registerMessageTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_message',
          arguments: { key: 'Greeting', language: 'fr', message: 'Salut' },
        });
        const text = firstText(result);
        expect(text).toContain('updated successfully');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_ui_message',
          EXISTING_SYS_ID,
          expect.objectContaining({ message: 'Salut' }),
        );
        // key/language are identifiers, never patched.
        expect(mockClient.patchRecord).not.toHaveBeenCalledWith(
          'sys_ui_message',
          EXISTING_SYS_ID,
          expect.objectContaining({ key: expect.anything() }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('errors when the message does not exist for that key+language', async () => {
      const result = await mcpClient.callTool({
        name: 'update_message',
        arguments: { key: 'Missing', message: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('No UI message with key');
    });

    it('returns no-op when no message text is provided', async () => {
      const mockClient = withListResults([{ sys_id: ref(EXISTING_SYS_ID) }]);
      const pair = await buildTestPair(registerMessageTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_message',
          arguments: { key: 'Greeting', language: 'fr' },
        });
        expect(firstText(result)).toContain('No fields to update');
        expect(mockClient.patchRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('list_messages', () => {
    it('returns a no-match message when nothing matches', async () => {
      const result = await mcpClient.callTool({
        name: 'list_messages',
        arguments: { key_contains: 'nope' },
      });
      expect(firstText(result)).toContain('No UI messages matched');
      expect(result.isError).toBeFalsy();
    });

    it('renders each message with its language tag on one line', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          key: ref('Greeting'),
          language: ref('fr'),
          message: ref('Bonjour'),
        },
      ]);
      const pair = await buildTestPair(registerMessageTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_messages',
          arguments: { key_contains: 'Greet' },
        });
        const text = firstText(result);
        expect(text).toContain('[fr]');
        expect(text).toContain('Greeting');
        expect(text).toContain('Bonjour');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('get_message', () => {
    it('returns a two-block rich result with summary then JSON', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          key: ref('Greeting'),
          language: ref('fr'),
          message: ref('Bonjour'),
        },
      ]);
      const pair = await buildTestPair(registerMessageTools, mockClient);
      try {
        const result = (await pair.mcpClient.callTool({
          name: 'get_message',
          arguments: { key: 'Greeting', language: 'fr' },
        })) as { content: Array<{ type: string; text: string }> };
        expect(result.content).toHaveLength(2);
        expect(result.content[0].text).toContain('UI Message');
        const parsed = JSON.parse(result.content[1].text);
        expect(parsed.sys_id).toBe(EXISTING_SYS_ID);
        expect(parsed.language).toBe('fr');
        expect(parsed.message).toBe('Bonjour');
      } finally {
        await pair.teardown();
      }
    });

    it('defaults language to en when omitted', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          key: ref('Greeting'),
          language: ref('en'),
          message: ref('Hello'),
        },
      ]);
      const pair = await buildTestPair(registerMessageTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'get_message',
          arguments: { key: 'Greeting' },
        });
        expect(mockClient.listRecords).toHaveBeenCalledWith(
          'sys_ui_message',
          'key=Greeting^language=en',
          undefined,
          1,
        );
      } finally {
        await pair.teardown();
      }
    });

    it('errors when the message does not exist', async () => {
      const result = await mcpClient.callTool({
        name: 'get_message',
        arguments: { key: 'Missing' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('No UI message with key');
    });
  });
});
