import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNowClient, SnApiError } from './servicenow.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const INSTANCE_URL = 'https://dev99999.service-now.com';
const USERNAME = 'admin';
const PASSWORD = 'secret';
const SYS_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

function okResponse(result: unknown, status = 200) {
  return {
    ok: true,
    status,
    statusText: 'OK',
    json: async () => ({ result }),
    text: async () => JSON.stringify({ result }),
  };
}

function errorResponse(status: number, statusText: string, body: string) {
  return {
    ok: false,
    status,
    statusText,
    json: vi.fn(),
    text: async () => body,
  };
}

describe('ServiceNowClient', () => {
  let client: ServiceNowClient;

  beforeEach(() => {
    client = new ServiceNowClient({
      instanceUrl: INSTANCE_URL,
      username: USERNAME,
      password: PASSWORD,
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('request building', () => {
    it('always sends sysparm_display_value=all', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true');
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.searchParams.get('sysparm_display_value')).toBe('all');
    });

    it('always sends sysparm_exclude_reference_link=true', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true');
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.searchParams.get('sysparm_exclude_reference_link')).toBe(
        'true',
      );
    });

    it('sends sysparm_query and sysparm_limit for listRecords', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true', undefined, 42);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.searchParams.get('sysparm_query')).toBe('active=true');
      expect(url.searchParams.get('sysparm_limit')).toBe('42');
    });

    it('sends sysparm_fields when fields array is provided', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true', [
        'sys_id',
        'name',
      ]);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.searchParams.get('sysparm_fields')).toBe('sys_id,name');
    });

    it('omits sysparm_fields when no fields provided', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true');
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.searchParams.has('sysparm_fields')).toBe(false);
    });

    it('builds correct URL path for listRecords', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_category', 'active=true');
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.pathname).toBe('/api/now/table/sc_category');
    });

    it('builds correct URL path for getRecord', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({}));
      await client.getRecord('sc_cat_item', SYS_ID);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.pathname).toBe(`/api/now/table/sc_cat_item/${SYS_ID}`);
    });

    it('strips trailing slash from instanceUrl', async () => {
      const trailingClient = new ServiceNowClient({
        instanceUrl: `${INSTANCE_URL}/`,
        username: USERNAME,
        password: PASSWORD,
      });
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await trailingClient.listRecords('sc_cat_item', 'active=true');
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.origin).toBe(INSTANCE_URL);
    });

    it('sends Basic Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true');
      const reqInit = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = reqInit.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
    });

    it('sends Accept: application/json header', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true');
      const reqInit = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = reqInit.headers as Record<string, string>;
      expect(headers.Accept).toBe('application/json');
    });

    it('sends POST for createRecord with body', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({ sys_id: { value: SYS_ID, display_value: SYS_ID } }),
      );
      await client.createRecord('sc_cat_item', { name: 'Test' });
      const reqInit = mockFetch.mock.calls[0][1] as RequestInit;
      expect(reqInit.method).toBe('POST');
      expect(reqInit.body).toBe(JSON.stringify({ name: 'Test' }));
    });

    it('uses GET by default', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await client.listRecords('sc_cat_item', 'active=true');
      const reqInit = mockFetch.mock.calls[0][1] as RequestInit;
      expect(reqInit.method ?? 'GET').toBe('GET');
    });
  });

  describe('response handling', () => {
    it('returns the result array from a list response', async () => {
      const records = [
        {
          sys_id: { value: SYS_ID, display_value: SYS_ID },
          name: { value: 'Test', display_value: 'Test' },
        },
      ];
      mockFetch.mockResolvedValueOnce(okResponse(records));
      const result = await client.listRecords('sc_cat_item', 'active=true');
      expect(result).toEqual(records);
    });

    it('returns the result object from a single-record response', async () => {
      const record = { sys_id: { value: SYS_ID, display_value: SYS_ID } };
      mockFetch.mockResolvedValueOnce(okResponse(record));
      const result = await client.getRecord('sc_cat_item', SYS_ID);
      expect(result).toEqual(record);
    });

    it('returns undefined for 204 No Content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: vi.fn(),
        text: vi.fn(),
      });
      const result = await client.patchRecord('sc_cat_item', SYS_ID, {});
      expect(result).toBeUndefined();
    });

    it('throws SnApiError on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, 'Not Found', 'record not found'),
      );
      await expect(
        client.listRecords('sc_cat_item', 'active=true'),
      ).rejects.toThrow(SnApiError);
    });

    it('SnApiError carries status, statusText, body, and url', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(403, 'Forbidden', 'ACL restriction'),
      );
      let caught: SnApiError | undefined;
      await client
        .listRecords('sc_cat_item', 'active=true')
        .catch((e: unknown) => {
          caught = e as SnApiError;
        });
      expect(caught).toBeInstanceOf(SnApiError);
      expect(caught?.status).toBe(403);
      expect(caught?.statusText).toBe('Forbidden');
      expect(caught?.body).toBe('ACL restriction');
      expect(caught?.url).toContain('sc_cat_item');
    });

    it('SnApiError url includes the full request URL', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(500, 'Internal Server Error', 'boom'),
      );
      let caught: SnApiError | undefined;
      await client.getRecord('sc_cat_item', SYS_ID).catch((e: unknown) => {
        caught = e as SnApiError;
      });
      expect(caught?.url).toContain(INSTANCE_URL);
      expect(caught?.url).toContain(SYS_ID);
    });
  });

  describe('resolveCatalogItemSysId', () => {
    it('returns the input directly when it is already a valid sys_id (no fetch)', async () => {
      const result = await client.resolveCatalogItemSysId(SYS_ID);
      expect(result).toBe(SYS_ID);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('searches by name when input is not a sys_id and returns the sys_id', async () => {
      const records = [
        {
          sys_id: { value: SYS_ID, display_value: SYS_ID },
          name: { value: 'Laptop', display_value: 'Laptop' },
        },
      ];
      mockFetch.mockResolvedValueOnce(okResponse(records));
      const result = await client.resolveCatalogItemSysId('Laptop');
      expect(result).toBe(SYS_ID);
    });

    it('throws when no catalog item matches the name', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));
      await expect(
        client.resolveCatalogItemSysId('Nonexistent Item'),
      ).rejects.toThrow(/No active catalog item found/);
    });

    it('throws when multiple catalog items match the name', async () => {
      const makeItem = (id: string, name: string) => ({
        sys_id: { value: id, display_value: id },
        name: { value: name, display_value: name },
      });
      mockFetch.mockResolvedValueOnce(
        okResponse([
          makeItem('a'.repeat(32), 'Laptop A'),
          makeItem('b'.repeat(32), 'Laptop B'),
        ]),
      );
      await expect(client.resolveCatalogItemSysId('Laptop')).rejects.toThrow(
        /Multiple catalog items match/,
      );
    });
  });

  describe('getUsername', () => {
    it('returns the configured username', () => {
      expect(client.getUsername()).toBe(USERNAME);
    });
  });

  describe('executeBackgroundScriptTrigger', () => {
    const TRIGGER_SYS_ID = 'f'.repeat(32);
    const TRIGGER_NAME = 'MCP_Script_1234567890';

    function mockTimezone(tz = 'UTC') {
      mockFetch.mockResolvedValueOnce(
        okResponse([{ value: { value: tz, display_value: tz } }]),
      );
    }

    function mockTriggerCreate() {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          sys_id: { value: TRIGGER_SYS_ID, display_value: TRIGGER_SYS_ID },
          name: { value: TRIGGER_NAME, display_value: TRIGGER_NAME },
        }),
      );
    }

    it('returns success result with trigger sys_id and name', async () => {
      mockTimezone();
      mockTriggerCreate();
      const result =
        await client.executeBackgroundScriptTrigger('gs.print("hello");');
      expect(result.success).toBe(true);
      expect(result.trigger_sys_id).toBe(TRIGGER_SYS_ID);
      expect(result.trigger_name).toBe(TRIGGER_NAME);
      expect(result.message).toContain('UTC');
    });

    it('propagates SnApiError without wrapping when the API call fails', async () => {
      mockTimezone();
      mockFetch.mockResolvedValueOnce(
        errorResponse(403, 'Forbidden', 'ACL restriction'),
      );
      await expect(
        client.executeBackgroundScriptTrigger('gs.print("hello");'),
      ).rejects.toThrow(SnApiError);
    });

    it('SnApiError from executeBackgroundScriptTrigger retains status and body', async () => {
      mockTimezone();
      mockFetch.mockResolvedValueOnce(
        errorResponse(403, 'Forbidden', 'ACL restriction'),
      );
      let caught: SnApiError | undefined;
      await client
        .executeBackgroundScriptTrigger('gs.print("hello");')
        .catch((e: unknown) => {
          caught = e as SnApiError;
        });
      expect(caught).toBeInstanceOf(SnApiError);
      expect(caught?.status).toBe(403);
      expect(caught?.body).toBe('ACL restriction');
    });
  });
});
