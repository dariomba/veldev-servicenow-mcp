import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { buildServer } from '../server.js';
import { buildTestPair, firstText } from '../tests/helpers.js';

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
        "create_script_include": "write",
        "execute_background_script": "write",
        "find_reusable_variables": "read",
        "find_user_criteria": "read",
        "get_atf_step_config_schema": "read",
        "get_atf_test": "read",
        "get_catalog_item_definition": "read",
        "get_current_update_set": "read",
        "get_record": "read",
        "list_atf_step_configs": "read",
        "list_atf_tests": "read",
        "list_catalog_categories": "read",
        "list_catalog_items": "read",
        "list_catalogs": "read",
        "list_flows": "read",
        "list_variable_set_variables": "read",
        "list_workflows": "read",
        "query_records": "read",
        "resolve_table": "read",
        "run_fix_script": "write",
        "update_atf_step": "write",
        "update_atf_test": "write",
        "update_atf_test_suite": "write",
        "update_business_rule": "write",
        "update_catalog_client_script": "write",
        "update_catalog_item": "write",
        "update_fix_script": "write",
        "update_record": "write",
        "update_record_producer": "write",
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
