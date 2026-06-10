import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerAtfTools } from './atf.js';

const ref = (v: string) => ({ value: v, display_value: v });

const STEP_CONFIG_SYS = 'a0000000000000000000000000000001';
const INPUT_TABLE_VAR = 'b0000000000000000000000000000001';
const INPUT_FIELDS_VAR = 'c0000000000000000000000000000001';
const INPUT_RECORD_VAR = 'd0000000000000000000000000000001';
const TEST_SYS = 'e0000000000000000000000000000001';
const SUITE_SYS = 'f0000000000000000000000000000001';
const NEW_STEP_SYS = '10000000000000000000000000000001';
const PRODUCER_STEP_SYS = '20000000000000000000000000000001';
const NEW_RECORD_SYS = '30000000000000000000000000000001';

const INPUT_DEFS = [
  {
    sys_id: ref(INPUT_TABLE_VAR),
    element: ref('table'),
    label: ref('Table'),
    internal_type: ref('table_name'),
    mandatory: ref('true'),
    order: ref('100'),
    reference: ref(''),
    attributes: ref(''),
  },
  {
    sys_id: ref(INPUT_FIELDS_VAR),
    element: ref('field_values'),
    label: ref('Field values'),
    internal_type: ref('template_value'),
    mandatory: ref('true'),
    order: ref('200'),
    reference: ref(''),
    attributes: ref(''),
  },
  {
    sys_id: ref(INPUT_RECORD_VAR),
    element: ref('record'),
    label: ref('Record'),
    internal_type: ref('document_id'),
    mandatory: ref('false'),
    order: ref('300'),
    reference: ref(''),
    // Real ATF document_id inputs (e.g. the "Record" field) declare a mapper.
    attributes: ref(
      'element_mapping_provider=com.glide.automated_testing_framework.ATFVariableElementMapper',
    ),
  },
  {
    sys_id: ref('e0000000000000000000000000000001'),
    element: ref('assert_type'),
    label: ref('Assert type'),
    internal_type: ref('choice'),
    mandatory: ref('false'),
    order: ref('400'),
    reference: ref(''),
    attributes: ref(''),
    choice_table: ref(''),
    default_value: ref('record_successfully_inserted'),
  },
];

function buildMockClient(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceNowClient {
  // Captures the last upsert script so the sys_variable_value readback below can
  // echo what it wrote — that is what verifyInputsWritten polls to confirm.
  let lastUpsertScript = '';

  const listRecords = vi.fn(async (table: string): Promise<unknown[]> => {
    switch (table) {
      case 'sys_atf_step_config':
        return [
          { sys_id: ref(STEP_CONFIG_SYS), name: ref('Set Field Values') },
        ];
      case 'sys_atf_test':
        return [
          {
            sys_id: ref(TEST_SYS),
            name: ref('RCP — Submit happy path'),
            description: ref('Happy path'),
            active: ref('true'),
            sys_updated_on: ref('2026-06-10 12:00:00'),
          },
        ];
      case 'atf_input_variable':
        return INPUT_DEFS;
      case 'atf_output_variable':
        return [
          {
            element: ref('record_id'),
            label: ref('Record'),
            internal_type: ref('document_id'),
          },
        ];
      case 'sys_choice':
        // ATF stores choice options in sys_choice under the config's pool
        // column, duplicated per language — verifyChoices dedupes by value.
        return [
          {
            element: ref('assert_type'),
            value: ref('record_successfully_inserted'),
            label: ref('Record successfully inserted'),
          },
          {
            element: ref('assert_type'),
            value: ref('record_successfully_inserted'),
            label: ref('Se insertó el registro'),
          },
          {
            element: ref('assert_type'),
            value: ref('record_not_inserted'),
            label: ref('Record was not inserted'),
          },
        ];
      case 'sys_variable_value': {
        // Reconstruct the rows the upsert script's setVal() calls would write so
        // verifyInputsWritten sees the intended values and confirms immediately.
        const rows: unknown[] = [];
        const re =
          /setVal\("[0-9a-f]+",\s*"([0-9a-f]+)",\s*"((?:[^"\\]|\\.)*)"/g;
        let m: RegExpExecArray | null = re.exec(lastUpsertScript);
        while (m !== null) {
          rows.push({
            variable: ref(m[1]),
            value: ref(JSON.parse(`"${m[2]}"`)),
          });
          m = re.exec(lastUpsertScript);
        }
        return rows;
      }
      default:
        return [];
    }
  });

  const createRecord = vi.fn(async (table: string): Promise<unknown> => {
    if (table === 'sys_atf_step') return { sys_id: ref(NEW_STEP_SYS) };
    if (table === 'sys_variable_value')
      return { sys_id: ref('99'.padEnd(32, '0')) };
    return { sys_id: ref(NEW_RECORD_SYS) };
  });

  return {
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
    getRecord: vi.fn().mockResolvedValue({
      sys_id: ref(TEST_SYS),
      order: ref('1'),
      step_config: {
        value: STEP_CONFIG_SYS,
        display_value: 'Set Field Values',
      },
    }),
    listRecords,
    createRecord,
    patchRecord: vi.fn().mockResolvedValue({}),
    executeBackgroundScriptTrigger: vi.fn(async (script: string) => {
      lastUpsertScript = script;
      return { success: true, trigger_sys_id: 'trig' };
    }),
    ...overrides,
  } as unknown as ServiceNowClient;
}

describe('atf tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(registerAtfTools, buildMockClient());
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  describe('create_atf_test', () => {
    it('creates the test and returns sys_id and URL', async () => {
      const result = await mcpClient.callTool({
        name: 'create_atf_test',
        arguments: { name: 'My Test' },
      });
      const text = firstText(result);
      expect(text).toContain('created successfully');
      expect(text).toContain(NEW_RECORD_SYS);
      expect(text).toContain('https://dev.example.com/sys_atf_test.do?sys_id=');
      expect(result.isError).toBeFalsy();
    });

    it('serialises active as a string', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_atf_test',
          arguments: { name: 'My Test', active: false },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_atf_test',
          expect.objectContaining({ name: 'My Test', active: 'false' }),
        );
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_atf_test', () => {
    it('soft-deletes via active=false', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_atf_test',
          arguments: { sys_id: TEST_SYS, active: false },
        });
        expect(mockClient.patchRecord).toHaveBeenCalledWith(
          'sys_atf_test',
          TEST_SYS,
          expect.objectContaining({ active: 'false' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError on invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_atf_test',
        arguments: { sys_id: 'nope', name: 'x' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('add_atf_test_to_suite', () => {
    it('creates the link with a defaulted order', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'add_atf_test_to_suite',
          arguments: { test_suite: SUITE_SYS, test: TEST_SYS },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_atf_test_suite_test',
          expect.objectContaining({
            test_suite: SUITE_SYS,
            test: TEST_SYS,
            order: '100',
          }),
        );
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('add_atf_step', () => {
    it('creates the step via the Table API and writes inputs via a server-side script', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'add_atf_step',
          arguments: {
            test: TEST_SYS,
            step_config: 'Set Field Values',
            inputs: [{ element: 'table', value: 'incident' }],
          },
        });
        const text = firstText(result);
        expect(text).toContain(NEW_STEP_SYS);

        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sys_atf_step',
          expect.objectContaining({
            test: TEST_SYS,
            step_config: STEP_CONFIG_SYS,
            order: '100',
            table: 'incident',
          }),
        );
        // input values must NOT go through the (ACL-blocked) Table API
        expect(mockClient.createRecord).not.toHaveBeenCalledWith(
          'sys_variable_value',
          expect.anything(),
        );
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(script).toContain('sys_variable_value');
        expect(script).toContain(NEW_STEP_SYS);
        expect(script).toContain(INPUT_TABLE_VAR);
        expect(script).toContain('incident');
      } finally {
        await pair.teardown();
      }
    });

    it('wires a document_id (element_mapping_provider) dependency as both a sys_variable_value token and a sys_element_mapping row', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'add_atf_step',
          arguments: {
            test: TEST_SYS,
            step_config: 'Set Field Values',
            inputs: [
              {
                element: 'record',
                map_from_step: PRODUCER_STEP_SYS,
                map_output: 'record_id',
              },
            ],
          },
        });
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(script).toContain(INPUT_RECORD_VAR);
        // Stored as the sys_id token (what the UI's dot-walking picker writes);
        // the data-pill text is display-only and never stored.
        expect(script).toContain(`{{step['${PRODUCER_STEP_SYS}'].record_id}}`);
        expect(script).not.toContain('{{Step 1:');
        // …and the companion sys_element_mapping row that makes the token
        // resolve at runtime (table = the config's pool column, field = element).
        expect(script).toContain('sys_element_mapping');
        expect(script).toContain(
          `var__m_atf_input_variable_${STEP_CONFIG_SYS}`,
        );
      } finally {
        await pair.teardown();
      }
    });

    it('encodes a step dependency into an encoded-query field as the sys_id token', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'add_atf_step',
          arguments: {
            test: TEST_SYS,
            step_config: 'Set Field Values',
            inputs: [
              {
                element: 'field_values',
                map_from_step: PRODUCER_STEP_SYS,
                map_output: 'record_id',
              },
            ],
          },
        });
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(script).toContain(INPUT_FIELDS_VAR);
        expect(script).toContain(`{{step['${PRODUCER_STEP_SYS}'].record_id}}`);
        // Encoded-query fields embed the token in the value string and have no
        // element_mapping_provider — no sys_element_mapping row is written.
        expect(script).not.toContain('sys_element_mapping');
      } finally {
        await pair.teardown();
      }
    });

    it('rejects mapping a non-existent output on the producer step', async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: {
          test: TEST_SYS,
          step_config: 'Set Field Values',
          inputs: [
            {
              element: 'record',
              map_from_step: PRODUCER_STEP_SYS,
              map_output: 'not_an_output',
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('is not an output of step');
    });

    it('rejects a choice value outside the resolved option list', async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: {
          test: TEST_SYS,
          step_config: 'Set Field Values',
          inputs: [{ element: 'assert_type', value: 'bogus_assert' }],
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('is a choice');
      expect(text).toContain('record_successfully_inserted');
    });

    it('accepts a valid choice value', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'add_atf_step',
          arguments: {
            test: TEST_SYS,
            step_config: 'Set Field Values',
            inputs: [{ element: 'assert_type', value: 'record_not_inserted' }],
          },
        });
        expect(result.isError).toBeFalsy();
        expect(firstText(result)).toContain('confirmed');
      } finally {
        await pair.teardown();
      }
    });

    it('auto-fills omitted inputs from the step config dictionary defaults', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'add_atf_step',
          arguments: {
            test: TEST_SYS,
            step_config: 'Set Field Values',
            inputs: [{ element: 'table', value: 'incident' }],
          },
        });
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        // assert_type was omitted but declares default_value — written like the UI would.
        expect(script).toContain('record_successfully_inserted');
        const text = firstText(result);
        expect(text).toContain('Defaults:');
        expect(text).toContain('assert_type=record_successfully_inserted');
        // The assert input ended up set, so no vacuous-assert warning.
        expect(text).not.toContain('asserts nothing');
      } finally {
        await pair.teardown();
      }
    });

    it("lists the new step's output elements for downstream mapping", async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: {
          test: TEST_SYS,
          step_config: 'Set Field Values',
          inputs: [{ element: 'table', value: 'incident' }],
        },
      });
      const text = firstText(result);
      expect(text).toContain('Outputs:');
      expect(text).toContain('record_id [document_id]');
      expect(text).toContain(`map_from_step=${NEW_STEP_SYS}`);
    });

    it('rejects an unknown input element', async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: {
          test: TEST_SYS,
          step_config: 'Set Field Values',
          inputs: [{ element: 'nonexistent', value: 'x' }],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('Unknown input element');
    });

    it('rejects providing both value and a mapping', async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: {
          test: TEST_SYS,
          step_config: 'Set Field Values',
          inputs: [
            {
              element: 'record',
              value: 'abc',
              map_from_step: PRODUCER_STEP_SYS,
              map_output: 'record_id',
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not both');
    });

    it('rejects a non-sys_id literal for a document_id input', async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: {
          test: TEST_SYS,
          step_config: 'Set Field Values',
          inputs: [{ element: 'record', value: 'not-a-sys-id' }],
        },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('expects a 32-char sys_id');
    });

    it('returns isError on invalid test sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'add_atf_step',
        arguments: { test: 'bad', step_config: 'Set Field Values' },
      });
      expect(result.isError).toBe(true);
    });

    it('surfaces SnApiError with status in message', async () => {
      const mockClient = buildMockClient({
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(403, 'Forbidden', 'ACL', 'https://example.com'),
          ),
      });
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'add_atf_step',
          arguments: { test: TEST_SYS, step_config: 'Set Field Values' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('update_atf_step', () => {
    it('warns when an assert-type input is left empty', async () => {
      const result = await mcpClient.callTool({
        name: 'update_atf_step',
        arguments: {
          sys_id: NEW_STEP_SYS,
          inputs: [{ element: 'assert_type', value: '' }],
        },
      });
      expect(result.isError).toBeFalsy();
      const text = firstText(result);
      expect(text).toContain('⚠ Assert input "assert_type" is empty');
      expect(text).toContain('record_successfully_inserted');
    });
  });

  describe('list_atf_tests', () => {
    it('searches by name and filters by active by default', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'list_atf_tests',
          arguments: { name_contains: 'RCP' },
        });
        const query = (mockClient.listRecords as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as string;
        expect(query).toContain('active=true');
        expect(query).toContain('nameLIKERCP');
        expect(query).toContain('ORDERBYDESCsys_updated_on');
        const text = firstText(result);
        expect(text).toContain('RCP — Submit happy path');
        expect(text).toContain(TEST_SYS);
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });
  });

  describe('get_atf_step_config_schema', () => {
    it('returns inputs and outputs for a config resolved by name', async () => {
      const result = await mcpClient.callTool({
        name: 'get_atf_step_config_schema',
        arguments: { step_config: 'Set Field Values' },
      });
      const text = firstText(result);
      expect(text).toContain('table');
      expect(text).toContain('field_values');
      expect(text).toContain('record_id');
      // Choice inputs surface their valid values so they are seen before writing.
      expect(text).toContain('choices: record_successfully_inserted');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('list_atf_step_configs', () => {
    it('lists configs and filters by active by default', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerAtfTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'list_atf_step_configs',
          arguments: { name_contains: 'Set' },
        });
        const query = (mockClient.listRecords as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as string;
        expect(query).toContain('active=true');
        expect(query).toContain('deprecated=false');
        expect(query).toContain('nameLIKESet');
      } finally {
        await pair.teardown();
      }
    });
  });
});
