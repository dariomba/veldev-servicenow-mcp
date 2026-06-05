# Veldev ServiceNow MCP Server

[![CI](https://github.com/dariomba/veldev-servicenow-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dariomba/veldev-servicenow-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server for ServiceNow. Connect any MCP-compatible AI client (Claude, Cursor, VS Code, etc.) to your ServiceNow instance and interact with it in plain English.

Built and maintained by **Veldev** — an AI assistant for ServiceNow developers.

---

## Features

29 tools across 8 domains:

| Domain | What it covers |
|---|---|
| **Catalog (read)** | Browse items, get full definitions with variables, UI policies, client scripts, user criteria, variable sets |
| **Catalog (write)** | Create items, add/update variables, manage variable sets |
| **Record producers** | Create and update record producers (catalog forms that generate records in any table) |
| **UI policies** | Create and update catalog UI policies and their actions |
| **Client scripts** | Create and manage catalog client scripts |
| **Script includes** | Create reusable server-side script includes |
| **Business rules** | Create business rules with before/after/async modes |
| **Update sets** | List, switch, and export update sets |


---

## Quick start

### Option A — Local (recommended)

```bash
git clone https://github.com/dariomba/veldev-servicenow-mcp.git
cd veldev-servicenow-mcp
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your instance URL, username, password

# Start with hot reload
npm run dev
```

Your MCP server is now at `http://localhost:3000/mcp`.

### Option B — Docker

No prebuilt image is published yet — build it from the included `Dockerfile`:

```bash
git clone https://github.com/dariomba/veldev-servicenow-mcp.git
cd veldev-servicenow-mcp
docker build -t veldev-servicenow-mcp .

docker run -p 3000:3000 \
  -e SN_INSTANCE=https://your-instance.service-now.com \
  -e SN_USERNAME=admin \
  -e SN_PASSWORD=yourpassword \
  veldev-servicenow-mcp
```

---

## Connecting to an MCP client

### Claude Desktop / Claude.ai

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "servicenow": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Claude Code / Cursor / VS Code (stdio)

For clients that spawn the server as a subprocess, create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/path/to/veldev-servicenow-mcp/build/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SN_INSTANCE": "https://your-instance.service-now.com",
        "SN_USERNAME": "admin",
        "SN_PASSWORD": "yourpassword"
      }
    }
  }
}
```

Or run from source (no build step needed):

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/veldev-servicenow-mcp",
      "env": {
        "TRANSPORT": "stdio",
        "SN_INSTANCE": "https://your-instance.service-now.com",
        "SN_USERNAME": "admin",
        "SN_PASSWORD": "yourpassword"
      }
    }
  }
}
```

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `SN_INSTANCE` | ✅ | — | Full URL e.g. `https://dev12345.service-now.com` |
| `SN_USERNAME` | ✅ | — | ServiceNow username |
| `SN_PASSWORD` | ✅ | — | ServiceNow password |
| `PORT` | ❌ | `3000` | HTTP port |
| `TRANSPORT` | ❌ | `http` | `http` or `stdio` |
| `CREDENTIAL_PROVIDER` | ❌ | `env` | `env` (dev) or `header` (gateway mode) |
| `GATEWAY_SECRET` | ❌ | — | Required when `CREDENTIAL_PROVIDER=header` |
| `ALLOWED_ORIGIN` | ❌ | `*` in dev | CORS origin for HTTP transport |

Copy `.env.example` to `.env` to configure.

> **Free PDI:** Don't have a ServiceNow instance? Get a free Personal Developer Instance at [developer.servicenow.com](https://developer.servicenow.com).

---

## Example prompts

```
List all active catalog items in the "Hardware" category

Get the full definition of the "Laptop Request" catalog item, including variables and UI policies

What client scripts are on the New Employee Onboarding item?

Create a new catalog item called "VPN Access Request" with a text variable for business justification

Create a business rule on incident that sets priority to 1 when impact and urgency are both 1

Create a record producer called "New Hire Equipment" that generates an sc_req_item record, with a pre-insert script that maps the selected laptop model to the item field
```

---

## Developing & verifying tools with Claude

### 1. Set up credentials

```bash
cp .env.example .env
# Edit .env: set SN_INSTANCE, SN_USERNAME, SN_PASSWORD for a throwaway PDI
```

### 2. Connect Claude Code to the local server

Open this directory (`veldev-servicenow-mcp/`) in Claude Code. The `.mcp.json` at the
project root wires Claude Code to the server over stdio automatically — no
manual server start needed. Credentials come from `.env` via dotenv; they are
never stored in `.mcp.json`. See `.mcp.json.example` for the inline-credential form.

### 3. Automated quality hooks

`.claude/settings.json` wires three mechanisms that run without prompting:

| When | What runs | Effect |
|---|---|---|
| After every Write/Edit on a `.ts` file | `biome check --write` (auto-fix) + lint check | Formatting fixed in-place; remaining violations injected as feedback |
| When Claude declares a turn done | `npx tsc --noEmit` + `npm test` | Completion is **blocked** until both pass |
| Any `npm run *`, `npx tsc *`, `git status/diff/log` | — | **Pre-approved** — no permission prompt |

### 4. Live PDI verification (manual)

Hooks enforce lint, types, and tests automatically. They cannot verify live
ServiceNow API behaviour — only a real tool call can. After editing any tool,
do all three steps before finishing:

1. `/mcp` → **Reconnect** — Claude Code spawns the stdio server once at session
   start; edits are invisible until you reconnect.
2. **Call the changed tool** against the PDI with inputs that exercise the changed code path.
3. **Confirm the output shape**: no raw `{ value, display_value }` objects, no
   `undefined`/`null` in string fields, rich read tools return two blocks
   (plain-text summary first, full JSON second), errors go through `handleError`.

### Guardrails

- Always point `.env` at a **throwaway PDI**, never a shared or production instance.
- For write tools: state intent and confirm before any call that mutates a record.
- Never commit `.env` — it is gitignored.

---

## Development

```bash
npm run dev        # hot reload (tsx watch)
npm run build      # compile TypeScript → build/
npm test           # run test suite
npx tsc --noEmit   # type-check only
npm run lint       # Biome lint
```

See [CLAUDE.md](CLAUDE.md) for architecture decisions and contribution guidelines.

---

## Self-hosting

The server runs as a stateless HTTP service. Each request creates a fresh MCP session (credentials injected per request). It has no database — credentials come from environment variables.

For production self-hosting:
- Run behind a reverse proxy (nginx, Caddy, Railway, Fly.io)
- Use `TRANSPORT=http` (default) for remote deployments
- Health check: `GET /health`

---

## Roadmap

- **Multi-instance support** — named instances in config (`dev`, `staging`, `prod`), switchable per tool call or via a `switch_instance` tool
- **OAuth 2.0 auth** — client credentials and auth-code flows for ServiceNow instances with SSO
- **ITSM tools** — incident, change, problem read/write
- **Generic table tools** — `query_table`, `get_record`, `create_record`, `update_record` for any table not covered by curated tools

Contributions welcome — see [CLAUDE.md](CLAUDE.md) for the architecture guide.

---

## License

[MIT](LICENSE) — Veldev, Inc.
