import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import { registerPropertyTools } from './properties.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';

function ref(value: string) {
  return { value, display_value: value };
}

function buildMockClient(): ServiceNowClient {
  return {
    // Default: no existing record (create path), get path overrides as needed.
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

describe('property tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerPropertyTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_property', () => {
    it('creates a property and returns its sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'create_property',
        arguments: {
          name: 'x_myapp.feature.enabled',
          type: 'boolean',
          value: 'true',
        },
      });
      const text = firstText(result);
      expect(text).toContain('created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('x_myapp.feature.enabled');
      expect(result.isError).toBeFalsy();
    });

    it('serialises booleans to strings and applies defaults', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerPropertyTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_property',
          arguments: { name: 'x_myapp.simple', value: 'hello' },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_properties',
          expect.objectContaining({
            name: 'x_myapp.simple',
            value: 'hello',
            type: 'string',
            is_private: 'false',
            ignore_cache: 'false',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('GUARDRAIL: warns when type=integer but value is not a whole number', async () => {
      const result = await mcpClient.callTool({
        name: 'create_property',
        arguments: { name: 'x_myapp.count', type: 'integer', value: '30s' },
      });
      const text = firstText(result);
      expect(text).toContain('WARNING');
      expect(text).toContain('integer');
      expect(result.isError).toBeFalsy();
    });

    it('GUARDRAIL: warns when type=boolean but value is not true/false', async () => {
      const result = await mcpClient.callTool({
        name: 'create_property',
        arguments: { name: 'x_myapp.flag', type: 'boolean', value: 'yes' },
      });
      expect(firstText(result)).toContain('WARNING');
      expect(firstText(result)).toContain('boolean');
    });

    it('does NOT warn when integer value is a valid number', async () => {
      const result = await mcpClient.callTool({
        name: 'create_property',
        arguments: { name: 'x_myapp.count', type: 'integer', value: '30' },
      });
      expect(firstText(result)).not.toContain('WARNING');
    });

    it('returns existing record without creating when name already exists', async () => {
      const idempotentClient = withListResults([
        { sys_id: ref(EXISTING_SYS_ID) },
      ]);
      const pair = await buildTestPair(registerPropertyTools, idempotentClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_property',
          arguments: { name: 'x_myapp.feature.enabled', value: 'true' },
        });
        const text = firstText(result);
        expect(text).toContain('already exists');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
        expect(result.isError).toBeFalsy();
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
      const pair = await buildTestPair(registerPropertyTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_property',
          arguments: { name: 'x_myapp.x', value: 'y' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('500');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_property', () => {
    it('locates by name, patches, and lists updated fields', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          type: ref('string'),
          value: ref('old'),
        },
      ]);
      const pair = await buildTestPair(registerPropertyTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_property',
          arguments: { name: 'x_myapp.feature.enabled', value: 'new' },
        });
        const text = firstText(result);
        expect(text).toContain('updated successfully');
        expect(text).toContain(EXISTING_SYS_ID);
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_properties',
          EXISTING_SYS_ID,
          expect.objectContaining({ value: 'new' }),
        );
        // name is the identifier, never patched.
        expect(mockClient.patchRecord).not.toHaveBeenCalledWith(
          'sys_properties',
          EXISTING_SYS_ID,
          expect.objectContaining({ name: expect.anything() }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('uses the stored type to validate a value-only update', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          type: ref('integer'),
          value: ref('10'),
        },
      ]);
      const pair = await buildTestPair(registerPropertyTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_property',
          arguments: { name: 'x_myapp.count', value: 'abc' },
        });
        expect(firstText(result)).toContain('WARNING');
        expect(firstText(result)).toContain('integer');
      } finally {
        await pair.teardown();
      }
    });

    it('errors when the property does not exist', async () => {
      const result = await mcpClient.callTool({
        name: 'update_property',
        arguments: { name: 'x_myapp.missing', value: 'x' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('No system property named');
    });

    it('returns no-op when only the name is provided', async () => {
      const mockClient = withListResults([
        { sys_id: ref(EXISTING_SYS_ID), type: ref('string'), value: ref('v') },
      ]);
      const pair = await buildTestPair(registerPropertyTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'update_property',
          arguments: { name: 'x_myapp.feature.enabled' },
        });
        expect(firstText(result)).toContain('No fields to update');
        expect(mockClient.patchRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('list_properties', () => {
    it('returns a no-match message when nothing matches', async () => {
      const result = await mcpClient.callTool({
        name: 'list_properties',
        arguments: { name_contains: 'nope' },
      });
      expect(firstText(result)).toContain('No system properties matched');
      expect(result.isError).toBeFalsy();
    });

    it('renders each property on one line', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          name: ref('glide.ui.foo'),
          type: ref('boolean'),
          value: ref('true'),
          is_private: ref('false'),
        },
      ]);
      const pair = await buildTestPair(registerPropertyTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_properties',
          arguments: { name_contains: 'glide' },
        });
        const text = firstText(result);
        expect(text).toContain('glide.ui.foo');
        expect(text).toContain('[boolean]');
        expect(text).toContain(EXISTING_SYS_ID);
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('get_property', () => {
    it('returns a two-block rich result with summary then JSON', async () => {
      const mockClient = withListResults([
        {
          sys_id: ref(EXISTING_SYS_ID),
          name: ref('glide.ui.foo'),
          type: ref('boolean'),
          value: ref('true'),
          description: ref('A flag'),
          suffix: ref(''),
          is_private: ref('false'),
          ignore_cache: ref('false'),
          read_roles: ref(''),
          write_roles: ref('admin'),
        },
      ]);
      const pair = await buildTestPair(registerPropertyTools, mockClient);
      try {
        const result = (await pair.mcpClient.callTool({
          name: 'get_property',
          arguments: { name: 'glide.ui.foo' },
        })) as { content: Array<{ type: string; text: string }> };
        expect(result.content).toHaveLength(2);
        expect(result.content[0].text).toContain('System Property');
        const parsed = JSON.parse(result.content[1].text);
        expect(parsed.sys_id).toBe(EXISTING_SYS_ID);
        expect(parsed.type).toBe('boolean');
        expect(parsed.is_private).toBe(false);
        expect(parsed.write_roles).toBe('admin');
      } finally {
        await pair.teardown();
      }
    });

    it('errors when the property does not exist', async () => {
      const result = await mcpClient.callTool({
        name: 'get_property',
        arguments: { name: 'x_myapp.missing' },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('No system property named');
    });
  });
});
