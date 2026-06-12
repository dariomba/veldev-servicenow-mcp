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
  type ToolAccess,
  ToolRegistry,
  type ToolRegistryOptions,
} from './registry.js';

describe('tool access classification', () => {
  it('classifies every registered tool as read or write', () => {
    // Registration never calls ServiceNow — the client is only captured in
    // handler closures — so an empty stub is enough to build the server.
    const { registry } = buildServer({} as ServiceNowClient);

    // Security-relevant: a tool classified 'read' here will be callable
    // without write access once per-request enforcement lands. Any change
    // to this snapshot must be reviewed with that in mind.
    expect(registry.accessMap()).toMatchInlineSnapshot(`
      {
        "add_atf_step": "write",
        "add_atf_test_to_suite": "write",
        "associate_variable_set": "write",
        "attach_user_criteria": "write",
        "batch_create_catalog_client_scripts": "write",
        "batch_create_catalog_variables": "write",
        "batch_create_ui_policies": "write",
        "batch_create_ui_policy_actions": "write",
        "batch_update_catalog_variables": "write",
        "create_atf_test": "write",
        "create_atf_test_suite": "write",
        "create_business_rule": "write",
        "create_catalog_item": "write",
        "create_fix_script": "write",
        "create_record": "write",
        "create_record_producer": "write",
        "create_scheduled_record_generation": "write",
        "create_scheduled_report": "write",
        "create_scheduled_script": "write",
        "create_script_include": "write",
        "execute_background_script": "write",
        "find_reusable_variables": "read",
        "find_user_criteria": "read",
        "get_atf_step_config_schema": "read",
        "get_atf_test": "read",
        "get_catalog_item_definition": "read",
        "get_current_update_set": "read",
        "get_record": "read",
        "get_scheduled_job": "read",
        "list_atf_step_configs": "read",
        "list_atf_tests": "read",
        "list_catalog_categories": "read",
        "list_catalog_items": "read",
        "list_catalogs": "read",
        "list_flows": "read",
        "list_scheduled_jobs": "read",
        "list_variable_set_variables": "read",
        "list_workflows": "read",
        "query_records": "read",
        "resolve_table": "read",
        "run_fix_script": "write",
        "run_scheduled_job": "write",
        "update_atf_step": "write",
        "update_atf_test": "write",
        "update_atf_test_suite": "write",
        "update_business_rule": "write",
        "update_catalog_client_script": "write",
        "update_catalog_item": "write",
        "update_fix_script": "write",
        "update_record": "write",
        "update_record_producer": "write",
        "update_scheduled_record_generation": "write",
        "update_scheduled_report": "write",
        "update_scheduled_script": "write",
        "update_script_include": "write",
        "update_ui_policy": "write",
        "update_ui_policy_action": "write",
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
