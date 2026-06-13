import type { ServiceNowClient } from '../clients/servicenow.js';
import { SnApiError } from '../clients/servicenow.js';
import type { SnRecord, SnReference } from '../types/servicenow.js';

export function resolveValue(f: SnReference): string {
  return f.value;
}

export function resolveDisplay(f: SnReference): string {
  return f.display_value || f.value;
}

/** Null-safe sys_id read: '' when the field is absent. */
export function val(r: SnRecord, f: string): string {
  return r[f] ? resolveValue(r[f] as SnReference) : '';
}

/** Null-safe display-value read: '' when the field is absent. */
export function disp(r: SnRecord, f: string): string {
  return r[f] ? resolveDisplay(r[f] as SnReference) : '';
}

export function boolStr(f: SnReference): boolean {
  return f.value === 'true';
}

export function isSysId(s: string): boolean {
  return /^[0-9a-f]{32}$/i.test(s);
}

export function recordUrl(
  client: ServiceNowClient,
  table: string,
  sysId: string,
): string {
  return `${client.getInstanceUrl()}/${table}.do?sys_id=${sysId}`;
}

export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function errText(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/** The documented "rich read" shape: plain-text summary block, then full JSON. */
export function richResult(summary: string, data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: summary },
      { type: 'text' as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

/** Returns a ready-to-display error message when invalid, or null when valid. */
export function requireSysId(value: string, label: string): string | null {
  return isSysId(value) ? null : `"${value}" is not a valid ${label}.`;
}

export function handleError(err: unknown) {
  if (err instanceof SnApiError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `ServiceNow API error (HTTP ${err.status} ${err.statusText})`,
            `URL: ${err.url}`,
            `Body: ${err.body}`,
          ].join('\n'),
        },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}
