export type LogLevel = 'INFO' | 'DBG' | 'WARN' | 'ERR';

export function log(
  level: LogLevel,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const ts = new Date().toISOString();
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.error(`${ts} ${level.padEnd(4)} [servicenow-mcp] ${msg}${suffix}`);
}
