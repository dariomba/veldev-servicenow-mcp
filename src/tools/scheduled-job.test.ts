import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import { buildTestPair, firstText } from '../tests/helpers.js';
import { registerScheduledJobTools } from '../tools/scheduled-job.js';

const EXISTING_SYS_ID = 'aaaa1111bbbb2222aaaa1111bbbb2222';
const NEW_SYS_ID = 'cccc3333dddd4444cccc3333dddd4444';
const REPORT_SYS_ID = 'dddd4444eeee5555dddd4444eeee5555';
const TEMPLATE_SYS_ID = 'eeee5555ffff6666eeee5555ffff6666';

const ref = (value: string, display?: string) => ({
  value,
  display_value: display ?? value,
});

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: ref(NEW_SYS_ID),
      name: ref('Test Job'),
      run_type: ref('daily'),
      run_time: ref('1970-01-01 16:00:00', '08:00:00'),
    }),
    patchRecord: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn().mockResolvedValue({}),
    getInstanceUrl: vi.fn().mockReturnValue('https://dev.example.com'),
    executeBackgroundScriptTrigger: vi.fn().mockResolvedValue({
      success: true,
      trigger_sys_id: 'ffff6666aaaa7777ffff6666aaaa7777',
      trigger_name: 'MCP_RunNow_1717600000000',
      next_action: '06/12/2026 10:00:01',
      message: 'scheduled',
    }),
  } as unknown as ServiceNowClient;
}

describe('scheduled-job tools (in-memory MCP)', () => {
  let mcpClient: Client;
  let teardown: () => Promise<void>;

  beforeEach(async () => {
    const pair = await buildTestPair(
      registerScheduledJobTools,
      buildMockClient(),
    );
    mcpClient = pair.mcpClient;
    teardown = pair.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  // ── create_scheduled_script ───────────────────────────────────────────────

  describe('create_scheduled_script', () => {
    it('creates the record and returns sys_id and URL', async () => {
      const result = await mcpClient.callTool({
        name: 'create_scheduled_script',
        arguments: { name: 'Nightly cleanup', script: 'gs.info("hi");' },
      });
      const text = firstText(result);
      expect(text).toContain('Scheduled Script Execution created');
      expect(text).toContain(NEW_SYS_ID);
      expect(text).toContain('https://dev.example.com/sysauto_script.do');
      expect(result.isError).toBeFalsy();
    });

    it('sends the record to the sysauto_script table with run_type default daily', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: { name: 'Job', script: 'gs.info(1);' },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({
            name: 'Job',
            script: 'gs.info(1);',
            active: 'true',
            run_type: 'daily',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('computes run_period as an epoch duration from period_* fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'Periodic',
            script: 'gs.info(1);',
            run_type: 'periodically',
            period_days: 1,
            period_hours: 2,
            period_minutes: 30,
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({ run_period: '1970-01-02 02:30:00' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('serialises day-of-week and conditional as strings', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'Weekly',
            script: 'gs.info(1);',
            run_type: 'weekly',
            run_dayofweek: 3,
            run_time: '09:00:00',
            conditional: true,
            condition: 'gs.isInteractive()',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({
            run_dayofweek: '3',
            run_time: '09:00:00',
            conditional: 'true',
            condition: 'gs.isInteractive()',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('maps run_daysofweek to a comma-separated "Days of Week" string', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'Tue and Wed',
            script: 'gs.info(1);',
            run_type: 'weekly',
            run_daysofweek: [2, 3],
            run_time: '08:00:00',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({
            run_type: 'weekly',
            run_daysofweek: '2,3',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('maps week_in_month fields (run_weekinmonth + run_dayofweek)', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'Second Wednesday',
            script: 'gs.info(1);',
            run_type: 'week_in_month',
            run_weekinmonth: 2,
            run_dayofweek: 3,
            run_time: '10:00:00',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({
            run_type: 'week_in_month',
            run_weekinmonth: '2',
            run_dayofweek: '3',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('maps business-calendar fields (calendar, computed offset, offset_type=past→2)', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'BC job',
            script: 'gs.info(1);',
            run_type: 'business_calendar_start',
            business_calendar: '017d95a353f3001076bcddeeff7b121a',
            offset_type: 'past',
            offset_hours: 2,
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({
            run_type: 'business_calendar_start',
            business_calendar: '017d95a353f3001076bcddeeff7b121a',
            offset_type: '2',
            offset: '1970-01-01 02:00:00',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('passes run_end (schedule end date) through to the body', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'Ending job',
            script: 'gs.info(1);',
            run_end: '2026-12-31 00:00:00',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_script',
          expect.objectContaining({ run_end: '2026-12-31 00:00:00' }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('routes a time_zone into advanced mode (entered_time + time_zone)', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: {
            name: 'TZ job',
            script: 'gs.info(1);',
            run_time: '09:00:00',
            time_zone: 'US/Eastern',
          },
        });
        // Advanced mode: the wall-clock goes to entered_time, the zone to
        // time_zone (not run_as_tz), and SN derives the GMT run_time itself.
        const body = vi.mocked(mockClient.createRecord).mock.calls[0][1];
        expect(body).toMatchObject({
          entered_time: '09:00:00',
          time_zone: 'US/Eastern',
          advanced: 'true',
          run_as_tz: '',
        });
        expect(body).not.toHaveProperty('run_time');
      } finally {
        await pair.teardown();
      }
    });

    it('skips creation when a job with the same name exists', async () => {
      const idempotentClient = {
        ...buildMockClient(),
        listRecords: vi
          .fn()
          .mockResolvedValue([{ sys_id: ref(EXISTING_SYS_ID) }]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerScheduledJobTools,
        idempotentClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: { name: 'Existing', script: 'gs.info(1);' },
        });
        expect(firstText(result)).toContain('already exists');
        expect(firstText(result)).toContain(EXISTING_SYS_ID);
        expect(idempotentClient.createRecord).not.toHaveBeenCalled();
      } finally {
        await pair.teardown();
      }
    });

    it('rejects an invalid run_time format with a validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_scheduled_script',
        arguments: { name: 'Bad', script: 'x', run_time: '9am' },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects an empty script with a validation error', async () => {
      const result = await mcpClient.callTool({
        name: 'create_scheduled_script',
        arguments: { name: 'Bad', script: '' },
      });
      expect(result.isError).toBe(true);
    });

    it('surfaces SnApiError with HTTP status', async () => {
      const errorClient = {
        ...buildMockClient(),
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(403, 'Forbidden', 'ACL', 'https://x'),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerScheduledJobTools, errorClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'create_scheduled_script',
          arguments: { name: 'Job', script: 'gs.info(1);' },
        });
        expect(result.isError).toBe(true);
        expect(firstText(result)).toContain('403');
      } finally {
        await pair.teardown();
      }
    });
  });

  // ── update_scheduled_script ───────────────────────────────────────────────

  describe('update_scheduled_script', () => {
    it('patches only the supplied fields', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'update_scheduled_script',
          arguments: { sys_id: EXISTING_SYS_ID, active: false },
        });
        const body = (mockClient.patchRecord as ReturnType<typeof vi.fn>).mock
          .calls[0][2] as Record<string, unknown>;
        expect(Object.keys(body)).toEqual(['active']);
        expect(body.active).toBe('false');
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError for an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'update_scheduled_script',
        arguments: { sys_id: 'nope', active: false },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain('not a valid');
    });
  });

  // ── create_scheduled_report ───────────────────────────────────────────────

  describe('create_scheduled_report', () => {
    it('sends report, recipients and default output_type to sysauto_report', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_report',
          arguments: {
            name: 'Weekly incidents',
            report: REPORT_SYS_ID,
            user_list: 'u1,u2',
            address_list: 'a@b.com',
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_report',
          expect.objectContaining({
            name: 'Weekly incidents',
            report: REPORT_SYS_ID,
            user_list: 'u1,u2',
            address_list: 'a@b.com',
            output_type: 'PDF',
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('maps PDF layout fields (page_size, custom pixels, include_with)', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_report',
          arguments: {
            name: 'Custom PDF',
            report: REPORT_SYS_ID,
            output_type: 'PDF',
            page_size: 'Custom',
            page_height_in_pixels: 1200,
            page_width_in_pixels: 800,
            include_with: TEMPLATE_SYS_ID,
          },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_report',
          expect.objectContaining({
            page_size: 'Custom',
            page_height_in_pixels: '1200',
            page_width_in_pixels: '800',
            include_with: TEMPLATE_SYS_ID,
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('requires the report field', async () => {
      const result = await mcpClient.callTool({
        name: 'create_scheduled_report',
        arguments: { name: 'No report' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ── create_scheduled_record_generation ────────────────────────────────────

  describe('create_scheduled_record_generation', () => {
    it('sends the template to sysauto_template', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'create_scheduled_record_generation',
          arguments: { name: 'Daily incident', template: TEMPLATE_SYS_ID },
        });
        expect(mockClient.createRecord).toHaveBeenCalledWith(
          'sysauto_template',
          expect.objectContaining({
            name: 'Daily incident',
            template: TEMPLATE_SYS_ID,
          }),
        );
      } finally {
        await pair.teardown();
      }
    });

    it('requires the template field', async () => {
      const result = await mcpClient.callTool({
        name: 'create_scheduled_record_generation',
        arguments: { name: 'No template' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ── list_scheduled_jobs ───────────────────────────────────────────────────

  describe('list_scheduled_jobs', () => {
    it('queries the sysauto base table for job_type=all', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'list_scheduled_jobs',
          arguments: {},
        });
        const [table, query] = (
          mockClient.listRecords as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        expect(table).toBe('sysauto');
        expect(query).toContain('active=true');
      } finally {
        await pair.teardown();
      }
    });

    it('narrows to the child table for job_type=script', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        await pair.mcpClient.callTool({
          name: 'list_scheduled_jobs',
          arguments: { job_type: 'script', active_only: false },
        });
        const [table, query] = (
          mockClient.listRecords as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        expect(table).toBe('sysauto_script');
        expect(query).not.toContain('active=true');
      } finally {
        await pair.teardown();
      }
    });
  });

  // ── get_scheduled_job ─────────────────────────────────────────────────────

  describe('get_scheduled_job', () => {
    it('returns a summary plus JSON with type fields and next run', async () => {
      const richClient = {
        ...buildMockClient(),
        getRecord: vi.fn().mockResolvedValue({
          sys_id: ref(EXISTING_SYS_ID),
          name: ref('My job'),
          sys_class_name: ref('sysauto_script'),
          active: ref('true'),
          run_type: ref('daily'),
          run_time: ref('1970-01-01 16:00:00', '08:00:00'),
          script: ref('gs.info(1);'),
        }),
        listRecords: vi.fn().mockResolvedValue([
          {
            next_action: ref('2026-06-13 07:00:00', '2026-06-13 00:00:00'),
            state: ref('0', 'Ready'),
          },
        ]),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(registerScheduledJobTools, richClient);
      try {
        const result = (await pair.mcpClient.callTool({
          name: 'get_scheduled_job',
          arguments: { sys_id: EXISTING_SYS_ID },
        })) as { content: Array<{ type: string; text: string }> };
        expect(result.content).toHaveLength(2);
        expect(result.content[0].text).toContain('My job');
        expect(result.content[0].text).toContain('Next run');
        const json = JSON.parse(result.content[1].text);
        expect(json.type).toBe('sysauto_script');
        expect(json.details.script).toBe('gs.info(1);');
        // next_run surfaces the absolute UTC value, not the instance-tz display.
        expect(json.next_run).toBe('2026-06-13 07:00:00 UTC');
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError for an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'get_scheduled_job',
        arguments: { sys_id: 'bad' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ── run_scheduled_job ─────────────────────────────────────────────────────

  describe('run_scheduled_job', () => {
    it('runs executeNow via a background trigger and returns trigger details', async () => {
      const mockClient = buildMockClient();
      const pair = await buildTestPair(registerScheduledJobTools, mockClient);
      try {
        const result = await pair.mcpClient.callTool({
          name: 'run_scheduled_job',
          arguments: { sys_id: EXISTING_SYS_ID },
        });
        const script = (
          mockClient.executeBackgroundScriptTrigger as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as string;
        expect(script).toContain('SncTriggerSynchronizer.executeNow');
        expect(script).toContain(EXISTING_SYS_ID);
        expect(firstText(result)).toContain('execution requested');
      } finally {
        await pair.teardown();
      }
    });

    it('returns isError for an invalid sys_id', async () => {
      const result = await mcpClient.callTool({
        name: 'run_scheduled_job',
        arguments: { sys_id: 'bad' },
      });
      expect(result.isError).toBe(true);
    });
  });
});
