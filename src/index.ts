import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  type CredentialProvider,
  EnvCredentialProvider,
  HeaderCredentialProvider,
} from './auth/provider.js';
import { ServiceNowClient } from './clients/servicenow.js';
import { config } from './config/config.js';
import {
  formatConfigError,
  type ServiceNowConfig,
  serviceNowConfigSchema,
} from './config/sn-config.js';
import { log } from './logger.js';
import { sessionStore } from './session-store.js';
import { registerBackgroundScriptTools } from './tools/background-script.js';
import { registerBusinessRuleTools } from './tools/business-rule.js';
import { registerCatalogClientScriptTools } from './tools/catalog-client-script.js';
import { registerCatalogReadTools } from './tools/catalog-read.js';
import { registerCatalogWriteTools } from './tools/catalog-write.js';
import { registerFixScriptTools } from './tools/fix-script.js';
import { registerRecordProducerTools } from './tools/record-producer.js';
import { registerScriptIncludeTools } from './tools/script-include.js';
import { registerUiPolicyTools } from './tools/ui-policy-write.js';
import { registerUpdateSetTools } from './tools/update-sets.js';

function buildSnConfig(): ServiceNowConfig {
  const result = serviceNowConfigSchema.safeParse({
    authType: config.sn.authType,
    grantType: config.sn.grantType,
    instanceUrl: config.sn.instance,
    clientId: config.sn.clientId,
    clientSecret: config.sn.clientSecret,
    username: config.sn.username,
    password: config.sn.password,
  });

  if (!result.success) {
    log(
      'ERR',
      `Invalid ServiceNow configuration: ${formatConfigError(result.error)}`,
    );
    process.exit(1);
  }

  return result.data;
}

function createCredentialProvider(): CredentialProvider {
  switch (config.credentialProvider) {
    case 'env':
      return new EnvCredentialProvider(buildSnConfig());
    case 'header': {
      if (!config.gatewaySecret) {
        log(
          'ERR',
          'GATEWAY_SECRET is required when CREDENTIAL_PROVIDER=header',
        );
        process.exit(1);
      }
      return new HeaderCredentialProvider(config.gatewaySecret);
    }
  }
}

const credentialProvider = createCredentialProvider();
const DEV_MODE = config.credentialProvider === 'env';

async function resolveCredentials(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<ServiceNowConfig | null> {
  const result = await credentialProvider.resolve(req);
  if (!result.ok) {
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: result.error }));
    return null;
  }
  return result.credentials;
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const reqStart = Date.now();
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const isSSE = req.method === 'GET';

  log('DBG', 'MCP request received', {
    method: req.method,
    sessionId: sessionId ?? '(none)',
    isSSE,
    activeSessions: sessionStore.size,
  });

  if (sessionId) {
    const existing = sessionStore.get(sessionId);

    if (existing) {
      sessionStore.touch(sessionId);
      existing.requestCount++;

      log(
        'DBG',
        isSSE ? 'SSE stream opened on existing session' : 'Reusing session',
        {
          sessionId,
          requestCount: existing.requestCount,
          sessionAgeSec: Math.round((Date.now() - existing.createdAt) / 1_000),
        },
      );

      // For the SSE GET we do NOT await — it stays open until client disconnects.
      const handlerPromise = existing.transport.handleRequest(req, res);

      if (isSSE) {
        // Log when the stream eventually closes (fires async, don't block).
        handlerPromise
          .then(() =>
            log('DBG', 'SSE stream closed', {
              sessionId,
              durationMs: Date.now() - reqStart,
            }),
          )
          .catch((err: unknown) =>
            log('WARN', 'SSE stream error', { sessionId, err: String(err) }),
          );
      } else {
        await handlerPromise;
        log('DBG', 'Request done (reused session)', {
          sessionId,
          durationMs: Date.now() - reqStart,
        });
      }
      return;
    }

    // Unknown session ID — server may have restarted; tell client to reinitialise.
    log('WARN', 'Unknown session ID — rejecting', { sessionId });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'session not found' }));
    return;
  }

  const credStart = Date.now();
  const credentials = await resolveCredentials(req, res);
  if (!credentials) return; // response already written

  log('INFO', 'Credentials resolved — creating new session', {
    credentialMs: Date.now() - credStart,
  });

  let resolvedSessionId: string | null = null;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      resolvedSessionId = sid;
      sessionStore.set(sid, {
        transport,
        server,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
        requestCount: 1,
      });
      log('INFO', 'Session initialised', {
        sessionId: sid,
        totalSessions: sessionStore.size,
      });
    },
  });

  const server = buildServer(credentials);

  transport.onclose = () => {
    if (resolvedSessionId) {
      const session = sessionStore.get(resolvedSessionId);
      log('INFO', 'Session transport closed', {
        sessionId: resolvedSessionId,
        requestCount: session?.requestCount ?? 0,
        lifetimeSec: session
          ? Math.round((Date.now() - session.createdAt) / 1_000)
          : 0,
      });
      sessionStore.delete(resolvedSessionId);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res);

  log('INFO', 'Request done (new session)', {
    sessionId: resolvedSessionId ?? '(pending)',
    durationMs: Date.now() - reqStart,
  });
}

async function startHttpServer(): Promise<void> {
  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, Mcp-Session-Id',
        );
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              server: 'servicenow-mcp',
              mode: DEV_MODE ? 'development' : 'production',
              activeSessions: sessionStore.size,
            }),
          );
          return;
        }

        if (req.url === '/mcp') {
          await handleMcpRequest(req, res);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: 'Not found. MCP endpoint is POST /mcp' }),
        );
      } catch (err) {
        log('ERR', 'Unhandled error in HTTP handler', { err: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal server error' }));
        }
      }
    },
  );

  httpServer.timeout = 120_000;
  httpServer.keepAliveTimeout = 65_000;

  httpServer.listen(config.port, () => {
    log('INFO', `HTTP server listening on port ${config.port}`);
    log('INFO', `MCP endpoint: http://localhost:${config.port}/mcp`);
    log('INFO', `Health check: http://localhost:${config.port}/health`);
    if (DEV_MODE) {
      log('INFO', 'DEV MODE active — JWT auth disabled');
      log('INFO', `Instance: ${config.sn.instance}`);
    }
  });

  const shutdown = () => {
    log('INFO', 'Shutdown signal received');
    for (const [id, session] of sessionStore.entries()) {
      session.transport.close().catch(() => {});
      sessionStore.delete(id);
    }
    httpServer.close(() => {
      log('INFO', 'HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      log('WARN', 'Forcing shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function startStdioServer(): Promise<void> {
  const server = buildServer(buildSnConfig());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('INFO', 'Running in stdio mode');
}

function buildServer(credentials: ServiceNowConfig): McpServer {
  const snClient = new ServiceNowClient(credentials);
  const server = new McpServer({ name: 'servicenow-mcp', version: '0.1.0' });

  registerCatalogReadTools(server, snClient);
  registerCatalogWriteTools(server, snClient);
  registerRecordProducerTools(server, snClient);
  registerUiPolicyTools(server, snClient);
  registerCatalogClientScriptTools(server, snClient);
  registerScriptIncludeTools(server, snClient);
  registerBusinessRuleTools(server, snClient);
  registerUpdateSetTools(server, snClient);
  registerBackgroundScriptTools(server, snClient);
  registerFixScriptTools(server, snClient);

  return server;
}

async function main(): Promise<void> {
  log('INFO', `Starting in ${config.environment} mode`);
  if (config.transport === 'stdio') {
    await startStdioServer();
  } else {
    await startHttpServer();
  }
}

main().catch((err) => {
  log('ERR', 'Fatal error', { err: String(err) });
  process.exit(1);
});
