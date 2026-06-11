import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../logger.js';

/**
 * Access classification for a tool.
 *
 * 'write' covers anything that mutates ServiceNow state — including
 * server-side script execution, which is a write capability even when used
 * to read data. When in doubt, classify as 'write' (fail-closed).
 */
export type ToolAccess = 'read' | 'write';

/**
 * - 'enforce' — gateway mode with ACCESS_ENFORCEMENT=on: write tools deny
 *   unless the current request carries the access header with value 'write'.
 * - 'observe' — gateway mode with the flag off: passthrough, but log the
 *   resolved access per write-tool call so prod logs prove the header
 *   arrives correctly before the flip.
 * - 'off' — env/stdio mode: passthrough, no logging (no gateway headers).
 */
export type AccessEnforcementMode = 'enforce' | 'observe' | 'off';

export type ToolRegistryOptions = {
  enforcement: AccessEnforcementMode;
  /** Lowercase header name carrying the access value. */
  accessHeader?: string;
};

/**
 * Maps deploy-time config to the registry's enforcement mode. Enforcement is
 * only meaningful in gateway mode (header credentials); env/stdio servers
 * always behave as write regardless of the flag.
 */
export function deriveEnforcement(
  credentialProvider: 'env' | 'header',
  flag: 'on' | 'off',
): AccessEnforcementMode {
  if (credentialProvider !== 'header') return 'off';
  return flag === 'on' ? 'enforce' : 'observe';
}

const DEFAULT_ACCESS_HEADER = 'x-mcp-access';

const DENIED_MESSAGE =
  'This tool requires write access, which has not been granted for this ' +
  'request. Present a plan and get user approval first.';

/** Minimal view of the SDK's RequestHandlerExtra — always the handler's last arg. */
type HandlerExtra = {
  sessionId?: string;
  requestInfo?: {
    headers?: Record<string, string | string[] | undefined>;
  };
};

type ToolConfig<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema,
> = {
  access: ToolAccess;
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

/**
 * The only path to McpServer.registerTool. Requires every tool to declare
 * `access` at its registration site and derives the MCP `readOnlyHint`
 * annotation from it (the classification is authoritative — a conflicting
 * caller-supplied readOnlyHint is overridden; all other annotations are
 * preserved).
 */
export class ToolRegistry {
  private readonly access = new Map<string, ToolAccess>();
  private readonly enforcement: AccessEnforcementMode;
  private readonly accessHeader: string;

  constructor(
    private readonly server: McpServer,
    options: ToolRegistryOptions = { enforcement: 'off' },
  ) {
    this.enforcement = options.enforcement;
    this.accessHeader = options.accessHeader ?? DEFAULT_ACCESS_HEADER;
  }

  registerTool<
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    name: string,
    config: ToolConfig<OutputArgs, InputArgs>,
    cb: ToolCallback<InputArgs>,
  ): RegisteredTool {
    const { access, annotations, ...rest } = config;
    this.access.set(name, access);

    return this.server.registerTool<OutputArgs, InputArgs>(
      name,
      {
        ...rest,
        annotations: { ...annotations, readOnlyHint: access === 'read' },
      },
      this.wrapHandler(name, access, cb),
    );
  }

  /**
   * Every tool handler routes through here. Sessions outlive requests
   * (buildServer runs once per session) while the access grant is
   * per-request, so this check must read the *live* request's headers from
   * the handler's `extra` arg on every call — never session-creation state.
   * Default-deny: only an access header of exactly 'write' grants write;
   * missing header, malformed value, or missing requestInfo all resolve to
   * read. Read tools are never gated.
   */
  private wrapHandler<
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema,
  >(
    name: string,
    access: ToolAccess,
    cb: ToolCallback<InputArgs>,
  ): ToolCallback<InputArgs> {
    const handler = cb as (...args: unknown[]) => unknown;
    return ((...args: unknown[]) => {
      if (access === 'write' && this.enforcement !== 'off') {
        const extra = args.at(-1) as HandlerExtra | undefined;
        const granted = this.resolveAccess(extra);
        const sessionId = extra?.sessionId ?? '(none)';

        if (this.enforcement === 'enforce') {
          if (granted !== 'write') {
            log('WARN', 'Write tool call denied — write access not granted', {
              tool: name,
              sessionId,
            });
            return {
              isError: true,
              content: [{ type: 'text' as const, text: DENIED_MESSAGE }],
            };
          }
        } else {
          log('DBG', 'Resolved access for write-tool call (enforcement off)', {
            tool: name,
            access: granted,
            sessionId,
          });
        }
      }
      return handler(...args);
    }) as ToolCallback<InputArgs>;
  }

  private resolveAccess(extra: HandlerExtra | undefined): ToolAccess {
    const headers = extra?.requestInfo?.headers;
    if (!headers) return 'read';
    const raw = headers[this.accessHeader];
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'write'
      ? 'write'
      : 'read';
  }

  /** Tool name → access classification, sorted by name. */
  accessMap(): Record<string, ToolAccess> {
    return Object.fromEntries(
      [...this.access.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}
