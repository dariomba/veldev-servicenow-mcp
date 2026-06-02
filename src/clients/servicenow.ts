import { isSysId } from '../tools/helpers.js';
import type { SnReference } from '../types/servicenow.js';

export class SnApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`ServiceNow API error ${status} ${statusText} on ${url}`);
    this.name = 'SnApiError';
  }
}

interface SnTableResponse<T> {
  result: T;
}

export interface ServiceNowConfig {
  instanceUrl: string;
  username: string;
  password: string;
}

export class ServiceNowClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly _username: string;
  private cachedInstanceSettings?: { timezone: string };

  constructor(config: ServiceNowConfig) {
    // Normalise: strip trailing slash
    this.baseUrl = config.instanceUrl.replace(/\/$/, '');
    this._username = config.username;
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  getUsername(): string {
    return this._username;
  }

  private async request<T>(
    path: string,
    params: Record<string, string> = {},
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/now${path}`);

    // Always request display_value alongside raw value for reference fields
    url.searchParams.set('sysparm_display_value', 'all');
    url.searchParams.set('sysparm_exclude_reference_link', 'true');

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const { method = 'GET', body, timeoutMs = 30_000 } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      const text = await response.text();
      throw new SnApiError(
        response.status,
        response.statusText,
        text,
        url.toString(),
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return ((await response.json()) as SnTableResponse<T>).result;
  }

  async getRecord<T>(
    table: string,
    sysId: string,
    fields?: string[],
  ): Promise<T> {
    const params: Record<string, string> = {};
    if (fields?.length) {
      params.sysparm_fields = fields.join(',');
    }
    return this.request<T>(`/table/${table}/${sysId}`, params);
  }

  async listRecords<T>(
    table: string,
    query: string,
    fields?: string[],
    limit = 100,
  ): Promise<T[]> {
    const params: Record<string, string> = {
      sysparm_query: query,
      sysparm_limit: String(limit),
    };
    if (fields?.length) {
      params.sysparm_fields = fields.join(',');
    }
    return this.request<T[]>(`/table/${table}`, params);
  }

  async createRecord<T>(
    table: string,
    body: Record<string, unknown>,
    params: Record<string, string> = {},
  ): Promise<T> {
    return this.request<T>(`/table/${table}`, params, { method: 'POST', body });
  }

  async updateRecord<T>(
    table: string,
    sysId: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.request<T>(
      `/table/${table}/${sysId}`,
      {},
      { method: 'PUT', body },
    );
  }

  async patchRecord<T>(
    table: string,
    sysId: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.request<T>(
      `/table/${table}/${sysId}`,
      {},
      { method: 'PATCH', body },
    );
  }

  private async getInstanceTimezone(): Promise<string> {
    if (this.cachedInstanceSettings)
      return this.cachedInstanceSettings.timezone;

    const props = await this.listRecords<{ value: SnReference }>(
      'sys_properties',
      'name=glide.sys.timezone',
      ['value'],
      1,
    );

    const timezone = props[0]?.value.value ?? 'UTC';
    this.cachedInstanceSettings = { timezone };
    return timezone;
  }

  private formatInTimezone(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  }

  async executeBackgroundScriptTrigger(script: string) {
    const fireAt = new Date(Date.now() + 1000);
    // Table API glide_date_time fields expect UTC in YYYY-MM-DD HH:MM:SS without sysparm_input_display_value
    const nextActionUtc = fireAt.toISOString().replace('T', ' ').slice(0, 19);
    const timezone = await this.getInstanceTimezone();

    const trigger = await this.createRecord<{
      sys_id: SnReference;
      name: SnReference;
    }>('sys_trigger', {
      name: `MCP_Script_${Date.now()}`,
      script,
      next_action: nextActionUtc,
      trigger_type: '0',
      state: '0',
      description: 'Automated background script trigger via MCP',
    });

    const nextActionLocal = this.formatInTimezone(fireAt, timezone);
    return {
      success: true,
      trigger_sys_id: trigger.sys_id.value,
      trigger_name: trigger.name.value,
      next_action: nextActionLocal,
      message: `Script scheduled to run at ${nextActionLocal} (${timezone}).`,
    };
  }

  async resolveCatalogItemSysId(idOrName: string): Promise<string> {
    if (isSysId(idOrName)) {
      return idOrName;
    }

    // Try finding by exact name
    const results = await this.listRecords<{
      sys_id: SnReference;
      name: SnReference;
    }>(
      'sc_cat_item',
      `nameSTARTSWITH${idOrName}^active=true`,
      ['sys_id', 'name'],
      5,
    );

    if (results.length === 0) {
      throw new Error(
        `No active catalog item found matching "${idOrName}". ` +
          `Try passing the sys_id directly.`,
      );
    }
    if (results.length > 1) {
      const names = results.map((r) => `"${r.name.value}"`).join(', ');
      throw new Error(
        `Multiple catalog items match "${idOrName}": ${names}. ` +
          `Please be more specific or pass the sys_id directly.`,
      );
    }

    return results[0].sys_id.value;
  }
}
