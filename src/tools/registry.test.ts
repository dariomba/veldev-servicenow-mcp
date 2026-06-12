import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { buildServer } from '../server.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import {
  deriveEnforcement,
  parseAllowedToolsets,
  type ToolAccess,
  ToolRegistry,
  type ToolRegistryOptions,
} from './registry.js';

describe('tool inventory', () => {
  it('classifies every registered tool with access and toolset group', () => {
    // Registration never calls ServiceNow — the client is only captured in
    // handler closures — so an empty stub is enough to build the server.
    // No allowed-set → all toolsets register, so this is the full inventory.
    const { registry } = buildServer({} as ServiceNowClient);

    // Security-relevant: a tool classified 'read' here is callable without
    // write access under per-request enforcement. Any change to this
    // snapshot must be reviewed with that in mind. (Groups are UX scoping
    // only.)
    expect(registry.inventory()).toMatchInlineSnapshot(`
      {
        "add_atf_step": {
          "access": "write",
          "group": "atf",
        },
        "add_atf_test_to_suite": {
          "access": "write",
          "group": "atf",
        },
        "associate_variable_set": {
          "access": "write",
          "group": "catalog",
        },
        "attach_user_criteria": {
          "access": "write",
          "group": "catalog",
        },
        "batch_create_catalog_client_scripts": {
          "access": "write",
          "group": "catalog",
        },
        "batch_create_catalog_variables": {
          "access": "write",
          "group": "catalog",
        },
        "batch_create_ui_policies": {
          "access": "write",
          "group": "catalog",
        },
        "batch_create_ui_policy_actions": {
          "access": "write",
          "group": "catalog",
        },
        "batch_update_catalog_variables": {
          "access": "write",
          "group": "catalog",
        },
        "create_atf_test": {
          "access": "write",
          "group": "atf",
        },
        "create_atf_test_suite": {
          "access": "write",
          "group": "atf",
        },
        "create_business_rule": {
          "access": "write",
          "group": "scripts",
        },
        "create_catalog_item": {
          "access": "write",
          "group": "catalog",
        },
        "create_fix_script": {
          "access": "write",
          "group": "diagnostics",
        },
        "create_record": {
          "access": "write",
          "group": "records",
        },
        "create_record_producer": {
          "access": "write",
          "group": "catalog",
        },
        "create_script_include": {
          "access": "write",
          "group": "scripts",
        },
        "create_update_set": {
          "access": "write",
          "group": "update-sets",
        },
        "execute_background_script": {
          "access": "write",
          "group": "diagnostics",
        },
        "find_reusable_variables": {
          "access": "read",
          "group": "catalog",
        },
        "find_user_criteria": {
          "access": "read",
          "group": "catalog",
        },
        "get_atf_step_config_schema": {
          "access": "read",
          "group": "atf",
        },
        "get_atf_test": {
          "access": "read",
          "group": "atf",
        },
        "get_catalog_item_definition": {
          "access": "read",
          "group": "catalog",
        },
        "get_current_update_set": {
          "access": "read",
          "group": "update-sets",
        },
        "get_record": {
          "access": "read",
          "group": "records",
        },
        "list_atf_step_configs": {
          "access": "read",
          "group": "atf",
        },
        "list_atf_tests": {
          "access": "read",
          "group": "atf",
        },
        "list_catalog_categories": {
          "access": "read",
          "group": "catalog",
        },
        "list_catalog_items": {
          "access": "read",
          "group": "catalog",
        },
        "list_catalogs": {
          "access": "read",
          "group": "catalog",
        },
        "list_flows": {
          "access": "read",
          "group": "catalog",
        },
        "list_update_sets": {
          "access": "read",
          "group": "update-sets",
        },
        "list_variable_set_variables": {
          "access": "read",
          "group": "catalog",
        },
        "list_workflows": {
          "access": "read",
          "group": "catalog",
        },
        "query_records": {
          "access": "read",
          "group": "records",
        },
        "resolve_table": {
          "access": "read",
          "group": "catalog",
        },
        "run_fix_script": {
          "access": "write",
          "group": "diagnostics",
        },
        "set_current_update_set": {
          "access": "write",
          "group": "update-sets",
        },
        "update_atf_step": {
          "access": "write",
          "group": "atf",
        },
        "update_atf_test": {
          "access": "write",
          "group": "atf",
        },
        "update_atf_test_suite": {
          "access": "write",
          "group": "atf",
        },
        "update_business_rule": {
          "access": "write",
          "group": "scripts",
        },
        "update_catalog_client_script": {
          "access": "write",
          "group": "catalog",
        },
        "update_catalog_item": {
          "access": "write",
          "group": "catalog",
        },
        "update_fix_script": {
          "access": "write",
          "group": "diagnostics",
        },
        "update_record": {
          "access": "write",
          "group": "records",
        },
        "update_record_producer": {
          "access": "write",
          "group": "catalog",
        },
        "update_script_include": {
          "access": "write",
          "group": "scripts",
        },
        "update_ui_policy": {
          "access": "write",
          "group": "catalog",
        },
        "update_ui_policy_action": {
          "access": "write",
          "group": "catalog",
        },
      }
    `);
  });
});

describe('ToolRegistry', () => {
  it('derives readOnlyHint from access and preserves other annotations', async () => {
    const { mcpClient, teardown } = await buildTestPair((registry) => {
      registry.registerTool(
        'probe_read',
        {
          access: 'read',
          annotations: { openWorldHint: true },
        },
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      );
      registry.registerTool('probe_write', { access: 'write' }, async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      }));
    }, {} as ServiceNowClient);

    const { tools } = await mcpClient.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get('probe_read')?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
    });
    expect(byName.get('probe_write')?.annotations).toEqual({
      readOnlyHint: false,
    });

    await teardown();
  });

  it('routes handler calls through the wrapper unchanged', async () => {
    const { mcpClient, teardown } = await buildTestPair((registry) => {
      registry.registerTool(
        'echo',
        {
          access: 'read',
          inputSchema: { value: z.string() },
        },
        async ({ value }) => ({
          content: [{ type: 'text' as const, text: value }],
        }),
      );
    }, {} as ServiceNowClient);

    const result = await mcpClient.callTool({
      name: 'echo',
      arguments: { value: 'hello' },
    });
    expect(firstText(result)).toBe('hello');

    await teardown();
  });
});

describe('toolset scoping', () => {
  function stubServer(registered: string[]): McpServer {
    return {
      registerTool: (name: string) => {
        registered.push(name);
        return {} as RegisteredTool;
      },
    } as unknown as McpServer;
  }

  const noop = async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
  });

  it('scoped view stamps its toolset on every tool it registers', () => {
    const registry = new ToolRegistry(stubServer([]), { enforcement: 'off' });
    registry.scoped('catalog').registerTool('a', { access: 'read' }, noop);
    registry.scoped('records').registerTool('b', { access: 'write' }, noop);

    expect(registry.inventory()).toEqual({
      a: { access: 'read', group: 'catalog' },
      b: { access: 'write', group: 'records' },
    });
  });

  it('skips registration for toolsets outside the allowed-set', () => {
    const registered: string[] = [];
    const registry = new ToolRegistry(stubServer(registered), {
      enforcement: 'off',
      allowedToolsets: new Set(['records']),
    });
    registry.scoped('catalog').registerTool('a', { access: 'read' }, noop);
    registry.scoped('records').registerTool('b', { access: 'write' }, noop);

    expect(registered).toEqual(['b']);
    expect(registry.inventory()).toEqual({
      b: { access: 'write', group: 'records' },
    });
  });

  it('no allowed-set means every toolset registers', () => {
    const registered: string[] = [];
    const registry = new ToolRegistry(stubServer(registered), {
      enforcement: 'off',
    });
    registry.scoped('atf').registerTool('a', { access: 'read' }, noop);
    registry.scoped('update-sets').registerTool('b', { access: 'read' }, noop);

    expect(registered).toEqual(['a', 'b']);
  });

  it('buildServer with an allowed-set exposes exactly that subset of the full inventory', async () => {
    const full = buildServer({} as ServiceNowClient).registry.inventory();
    const expected = Object.keys(full).filter(
      (name) => full[name].group === 'records',
    );
    expect(expected.length).toBeGreaterThan(0);

    const { server } = buildServer({} as ServiceNowClient, {
      enforcement: 'off',
      allowedToolsets: new Set(['records']),
    });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
    await mcpClient.close();
  });
});

describe('parseAllowedToolsets', () => {
  it('absent header → undefined (all toolsets)', () => {
    expect(parseAllowedToolsets(undefined)).toBeUndefined();
  });

  it('valid subset, trimmed and case-insensitive', () => {
    expect(parseAllowedToolsets(' Catalog , SCRIPTS ')).toEqual(
      new Set(['catalog', 'scripts']),
    );
  });

  it('unknown names are dropped, known ones kept', () => {
    expect(parseAllowedToolsets('catalog,bogus')).toEqual(new Set(['catalog']));
  });

  it('fail-open: empty or all-unknown header → undefined (all toolsets)', () => {
    expect(parseAllowedToolsets('')).toBeUndefined();
    expect(parseAllowedToolsets(' , ')).toBeUndefined();
    expect(parseAllowedToolsets('bogus,nope')).toBeUndefined();
  });

  it('joins repeated headers (string array) before parsing', () => {
    expect(parseAllowedToolsets(['catalog', 'records,atf'])).toEqual(
      new Set(['catalog', 'records', 'atf']),
    );
  });
});

describe('deriveEnforcement', () => {
  it('maps credential mode + flag to the enforcement mode', () => {
    expect(deriveEnforcement('header', 'on')).toBe('enforce');
    expect(deriveEnforcement('header', 'off')).toBe('observe');
    expect(deriveEnforcement('env', 'on')).toBe('off');
    expect(deriveEnforcement('env', 'off')).toBe('off');
  });
});

describe('per-request access enforcement', () => {
  const okResult = { content: [{ type: 'text' as const, text: 'ok' }] };

  /**
   * Registers a single tool through a stub McpServer that captures the
   * wrapped handler, so tests can invoke it with a fabricated `extra` arg.
   */
  function captureWrapped(options: ToolRegistryOptions, access: ToolAccess) {
    let wrapped: (...args: unknown[]) => unknown = () => {
      throw new Error('tool was never registered');
    };
    const server = {
      registerTool: (
        _name: string,
        _config: unknown,
        cb: (...args: unknown[]) => unknown,
      ) => {
        wrapped = cb;
        return {} as RegisteredTool;
      },
    } as unknown as McpServer;

    const underlying = vi.fn(async () => okResult);
    new ToolRegistry(server, options).registerTool(
      'probe',
      { access },
      underlying,
    );
    return { call: (extra?: unknown) => wrapped(extra), underlying };
  }

  const grantedExtra = {
    sessionId: 'sess-1',
    requestInfo: { headers: { 'x-mcp-access': 'write' } },
  };

  it('enforcement off: write tool executes regardless of header', async () => {
    for (const extra of [
      grantedExtra,
      { sessionId: 'sess-1', requestInfo: { headers: {} } },
      { sessionId: 'sess-1' },
      undefined,
    ]) {
      const { call, underlying } = captureWrapped(
        { enforcement: 'off' },
        'write',
      );
      expect(await call(extra)).toEqual(okResult);
      expect(underlying).toHaveBeenCalledOnce();
    }
  });

  it('enforce: header "write" grants the call', async () => {
    const { call, underlying } = captureWrapped(
      { enforcement: 'enforce' },
      'write',
    );
    expect(await call(grantedExtra)).toEqual(okResult);
    expect(underlying).toHaveBeenCalledOnce();
  });

  it('enforce: default-deny for missing header, "read", junk, multi-value, missing requestInfo, missing extra', async () => {
    const deniedExtras: unknown[] = [
      { sessionId: 'sess-1', requestInfo: { headers: {} } },
      {
        sessionId: 'sess-1',
        requestInfo: { headers: { 'x-mcp-access': 'read' } },
      },
      {
        sessionId: 'sess-1',
        requestInfo: { headers: { 'x-mcp-access': 'admin; write' } },
      },
      {
        sessionId: 'sess-1',
        requestInfo: { headers: { 'x-mcp-access': ['write', 'write'] } },
      },
      { sessionId: 'sess-1' }, // no requestInfo
      undefined, // no extra at all
    ];

    for (const extra of deniedExtras) {
      const { call, underlying } = captureWrapped(
        { enforcement: 'enforce' },
        'write',
      );
      const result = (await call(extra)) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('requires write access');
      expect(underlying).not.toHaveBeenCalled();
    }
  });

  it('enforce: read tools are never gated', async () => {
    const { call, underlying } = captureWrapped(
      { enforcement: 'enforce' },
      'read',
    );
    expect(await call({ sessionId: 'sess-1' })).toEqual(okResult);
    expect(underlying).toHaveBeenCalledOnce();
  });

  it('observe: write tool executes without the header (pre-flip logging mode)', async () => {
    const { call, underlying } = captureWrapped(
      { enforcement: 'observe' },
      'write',
    );
    expect(await call({ sessionId: 'sess-1' })).toEqual(okResult);
    expect(underlying).toHaveBeenCalledOnce();
  });

  it('env mode derives "off" and writes work', async () => {
    const { call, underlying } = captureWrapped(
      { enforcement: deriveEnforcement('env', 'on') },
      'write',
    );
    expect(await call({ sessionId: 'sess-1' })).toEqual(okResult);
    expect(underlying).toHaveBeenCalledOnce();
  });

  it('respects a custom access header name', async () => {
    const { call, underlying } = captureWrapped(
      { enforcement: 'enforce', accessHeader: 'x-custom-access' },
      'write',
    );
    expect(
      await call({ requestInfo: { headers: { 'x-custom-access': 'write' } } }),
    ).toEqual(okResult);
    expect(underlying).toHaveBeenCalledOnce();
  });
});

describe('enforcement wiring through buildServer', () => {
  async function connect(server: McpServer) {
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    return mcpClient;
  }

  it('enforce mode denies a write tool call before the client is touched', async () => {
    // The in-memory transport carries no requestInfo — exactly the
    // default-deny path a gateway request without the header hits.
    const createRecord = vi.fn();
    const { server } = buildServer(
      { createRecord } as unknown as ServiceNowClient,
      { enforcement: 'enforce' },
    );
    const mcpClient = await connect(server);

    const result = await mcpClient.callTool({
      name: 'create_record',
      arguments: { table: 'incident', data: { short_description: 'x' } },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('requires write access');
    expect(createRecord).not.toHaveBeenCalled();
    await mcpClient.close();
  });

  it('enforce mode leaves read tools callable', async () => {
    const listRecords = vi.fn(async () => []);
    const { server } = buildServer(
      { listRecords } as unknown as ServiceNowClient,
      { enforcement: 'enforce' },
    );
    const mcpClient = await connect(server);

    const result = await mcpClient.callTool({
      name: 'query_records',
      arguments: { table: 'incident' },
    });

    expect(result.isError).toBeFalsy();
    expect(listRecords).toHaveBeenCalledOnce();
    await mcpClient.close();
  });

  it('enforcement off keeps write tools working end-to-end', async () => {
    const createRecord = vi.fn(async () => ({ sys_id: { value: 'abc123' } }));
    const { server } = buildServer(
      { createRecord } as unknown as ServiceNowClient,
      { enforcement: 'off' },
    );
    const mcpClient = await connect(server);

    const result = await mcpClient.callTool({
      name: 'create_record',
      arguments: { table: 'incident', data: { short_description: 'x' } },
    });

    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('abc123');
    expect(createRecord).toHaveBeenCalledOnce();
    await mcpClient.close();
  });
});
