# CLAUDE.md — ServiceNow MCP Server

Open-source TypeScript MCP server that exposes ServiceNow Table API as LLM tools.

---

## Commands

```bash
npm run dev        # hot reload (tsx watch)
npm test           # vitest
npx tsc --noEmit   # type-check (also runs automatically on Stop)
npm run lint       # Biome
```

---

## Architecture — non-negotiable

**Per-session McpServer**: `buildServer()` runs for each *new* request (no `Mcp-Session-Id`). Subsequent requests with a session ID reuse the server from `sessionStore`. Never move `buildServer()` outside the per-session path.

**No global client**: `ServiceNowClient` takes `{ instanceUrl, username, password }` at construction. Credentials come from `CredentialProvider.resolve(req)`. Never create a global client.

**`sysparm_display_value=all` on every SN request**: returns reference fields as `SnReference = { value: string, display_value: string }`. Never remove this param — tools return raw sys_ids with no labels.

**Tool output shape**: rich read tools return two content blocks — plain-text summary first, full JSON second. Write tools and simple lookups return a single text block.

---

## Coding conventions

- `.js` extensions in all import paths — ESM requirement even for `.ts` files
- `console.error` only — `console.log` corrupts stdio transport
- Use `resolveDisplay(f)` for human label, `resolveValue(f)` for sys_id — both in `src/tools/helpers.ts`; never redefine locally
- Use `handleError` from `src/tools/helpers.ts` in every tool's catch block
- `{ type: "text" as const, text: "..." }` — TypeScript requires the cast in content blocks
- `Promise.all()` for independent SN API calls — never sequential awaits in a loop

---

## Adding a tool

Create `src/tools/{domain}.ts`. Export `register{Domain}Tools(server, client)` and call it in `buildServer()` in `src/index.ts`. Use any existing tool file as the template.

After adding or modifying any tool you MUST do all three steps before finishing:
1. `/mcp` → Reconnect (Claude Code spawns the stdio server once — edits are invisible until you reconnect)
2. Call the changed tool against the PDI with inputs that exercise the changed code path
3. Confirm the output shape: no raw `{ value, display_value }` objects (use `resolveDisplay`/`resolveValue`), no `undefined`/`null` in string fields, rich read tools return two blocks (plain-text summary first, full JSON second), errors go through `handleError`

No hook enforces this — it is entirely your responsibility. Skipping step 1 means you are testing stale code.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SN_INSTANCE` | ✅ | `https://dev12345.service-now.com` |
| `SN_USERNAME` | ✅ | ServiceNow username |
| `SN_PASSWORD` | ✅ | ServiceNow password |
| `PORT` | ❌ | HTTP port (default `3000`) |
| `TRANSPORT` | ❌ | `http` (default) or `stdio` |
| `CREDENTIAL_PROVIDER` | ❌ | `env` (dev default) or `header` (gateway mode) |
| `GATEWAY_SECRET` | ❌ | Required when `CREDENTIAL_PROVIDER=header` |
