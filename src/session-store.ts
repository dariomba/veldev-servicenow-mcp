import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from './logger.js';

export interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActiveAt: number;
  createdAt: number;
  requestCount: number;
}

const SESSION_TTL_MS = 10 * 60 * 1_000; // 10 min
const CLEANUP_INTERVAL_MS = 60 * 1_000; //  1 min

class SessionStore {
  private readonly map = new Map<string, Session>();

  get size(): number {
    return this.map.size;
  }

  get(id: string): Session | undefined {
    return this.map.get(id);
  }

  set(id: string, session: Session): void {
    this.map.set(id, session);
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  touch(id: string): void {
    const s = this.map.get(id);
    if (s) s.lastActiveAt = Date.now();
  }

  entries(): IterableIterator<[string, Session]> {
    return this.map.entries();
  }
}

export const sessionStore = new SessionStore();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    const idleSec = Math.round((now - session.lastActiveAt) / 1_000);
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      log('INFO', `Session expired — evicting`, { sessionId: id, idleSec });
      session.transport.close().catch(() => {});
      sessionStore.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();
