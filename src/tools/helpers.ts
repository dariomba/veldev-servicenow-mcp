import { SnApiError } from '../clients/servicenow.js';
import type { SnReference } from '../types/servicenow.js';

export function resolveValue(f: SnReference): string {
  return f.value;
}

export function resolveDisplay(f: SnReference): string {
  return f.display_value || f.value;
}

export function boolStr(f: SnReference): boolean {
  return f.value === 'true';
}

export function isSysId(s: string): boolean {
  return /^[0-9a-f]{32}$/i.test(s);
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
