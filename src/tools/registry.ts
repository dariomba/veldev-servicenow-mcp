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

/**
 * Access classification for a tool.
 *
 * 'write' covers anything that mutates ServiceNow state — including
 * server-side script execution, which is a write capability even when used
 * to read data. When in doubt, classify as 'write' (fail-closed).
 */
export type ToolAccess = 'read' | 'write';

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

  constructor(private readonly server: McpServer) {}

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
   * Every tool handler routes through here. A passthrough today: the
   * per-request access check (X-MCP-Access header, call-time default-deny)
   * will be added here without touching any registration site.
   */
  private wrapHandler<
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema,
  >(
    _name: string,
    _access: ToolAccess,
    cb: ToolCallback<InputArgs>,
  ): ToolCallback<InputArgs> {
    const handler = cb as (...args: unknown[]) => unknown;
    return ((...args: unknown[]) =>
      handler(...args)) as ToolCallback<InputArgs>;
  }

  /** Tool name → access classification, sorted by name. */
  accessMap(): Record<string, ToolAccess> {
    return Object.fromEntries(
      [...this.access.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}
