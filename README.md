# Veldev ServiceNow MCP Server

[![CI](https://github.com/dariomba/veldev-servicenow-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dariomba/veldev-servicenow-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server for ServiceNow. Connect any MCP-compatible AI client (Claude, Cursor, VS Code, etc.) to your ServiceNow instance and interact with it in plain English.

Built and maintained by **Veldev** — an AI assistant for ServiceNow developers.

---

## Features

97 tools across 19 domains:

| Domain | What it covers |
|---|---|
| **Catalog (read)** | Browse items, get full definitions with variables, UI policies, client scripts, user criteria, variable sets |
| **Catalog (write)** | Create items, add/update variables, manage variable sets, attach user criteria |
| **Record producers** | Create and update record producers (catalog forms that generate records in any table) |
| **UI policies (catalog)** | Create and update catalog UI policies and their actions |
| **Client scripts (catalog)** | Create and manage catalog client scripts |
| **Script includes** | Create reusable server-side script includes |
| **Business rules** | Create business rules with before/after/async modes |
| **Client scripts (form)** | Create and update table client scripts (`sys_script_client`) — onLoad / onChange / onSubmit / onCellEdit |
| **UI policies (form)** | List, get, create, and update form/table UI policies (`sys_ui_policy`); batch-create and update their field actions (`sys_ui_policy_action`) and related list actions (`sys_ui_policy_rl_action`) |
| **UI actions** | List, get, create, and update UI actions (`sys_ui_action`) — form/list buttons, links, and context-menu items, including Configurable Workspace placement |
| **Update sets** | Show the active update set, list update sets by state/scope/name, create a new set, and switch the current set for the authenticated user |
| **Background scripts** | Schedule server-side JavaScript snippets via `sys_trigger` |
| **Fix scripts** | Create, update, and run `sys_script_fix` records — stored server-side scripts for data and config repairs |
| **Scheduled jobs** | Create, update, list, get, and run-now scheduled jobs (`sysauto`) — script executions, scheduled emails of reports, and template-based record generation |
| **Events** | Register events (`sysevent_register`), create custom processing queues (`sysevent_queue`) and script actions (`sysevent_script_action`), fire events at runtime via `gs.eventQueue()`, and list/get any of them |
| **Inbound email actions** | List, get, create, and update inbound email actions (`sysevent_in_email_action`) — server-side scripts that run when ServiceNow receives a New, Reply, or Forward email |
| **Notifications** | List, get, create, and update email notifications (`sysevent_email_action`) — outbound mail rules triggered on insert/update or by an event — and reusable email scripts (`sys_script_email`) embedded in a body via `${mail_script:<name>}` (`create_notification`, `update_notification`, `list_notifications`, `get_notification`, `create_email_script`, `update_email_script`, `list_email_scripts`, `get_email_script`) |
| **Generic Table CRUD** | Query, fetch, create, and update records in any ServiceNow table |
| **ATF (Automated Test Framework)** | Create tests and suites, add and configure steps with cross-step output mapping, browse step configs and their input/output schemas |

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

Copy `.env.example` to `.env` to configure.

| Variable | Required | Default | Description |
|---|---|---|---|
| `SN_INSTANCE` | ✅ | — | Full URL e.g. `https://dev12345.service-now.com` |
| `SN_AUTH_TYPE` | ❌ | `basic` | `basic` or `oauth` |
| `SN_USERNAME` | ✅ | — | ServiceNow username |
| `SN_PASSWORD` | ✅ | — | ServiceNow password |
| `SN_CLIENT_ID` | ✅ | — | OAuth client ID from Application Registry |
| `SN_CLIENT_SECRET` | ✅ | — | OAuth client secret |
| `SN_GRANT_TYPE` | ❌ | `password` | `password` or `client_credentials` |
| `PORT` | ❌ | `3000` | HTTP port |
| `TRANSPORT` | ❌ | `http` | `http` or `stdio` |
| `CREDENTIAL_PROVIDER` | ❌ | `env` | `env` (dev) or `header` (gateway mode) |
| `GATEWAY_SECRET` | ❌ | — | Required when `CREDENTIAL_PROVIDER=header` |
| `ALLOWED_ORIGIN` | ❌ | `*` in dev | CORS origin for HTTP transport |
| `ACCESS_ENFORCEMENT` | ❌ | `off` | `on` or `off`. Gateway mode only: when `on`, write tools require the access header with value `write` on each request (default-deny). Env/stdio servers always behave as write. |
| `ACCESS_HEADER` | ❌ | `x-mcp-access` | Header carrying the per-request access value (`write` grants write; anything else is read) |
| `TOOLSETS_HEADER` | ❌ | `x-mcp-toolsets` | Header naming the toolsets a new session registers (gateway mode only) — see [Gateway headers](#gateway-headers) |

¹ Required when `SN_AUTH_TYPE=basic` or `SN_GRANT_TYPE=password`  
² Required when `SN_AUTH_TYPE=oauth`

> **Free PDI:** Don't have a ServiceNow instance? Get a free Personal Developer Instance at [developer.servicenow.com](https://developer.servicenow.com).

---

## Authentication

### Basic auth (default)

```bash
SN_INSTANCE=https://dev12345.service-now.com
SN_USERNAME=admin
SN_PASSWORD=your-password
```

### OAuth 2.0

Supports **password** (ROPC) and **client_credentials** grant types. Tokens are requested automatically, cached in memory, and refreshed before expiry. A 401 response triggers a transparent token refresh and retry.

**Password grant** — user context preserved, works on PDIs:

```bash
SN_INSTANCE=https://dev12345.service-now.com
SN_AUTH_TYPE=oauth
SN_GRANT_TYPE=password
SN_CLIENT_ID=your-client-id
SN_CLIENT_SECRET=your-client-secret
SN_USERNAME=admin
SN_PASSWORD=your-password
```

**Client credentials** — service-to-service, no user credentials needed:

```bash
SN_INSTANCE=https://dev12345.service-now.com
SN_AUTH_TYPE=oauth
SN_GRANT_TYPE=client_credentials
SN_CLIENT_ID=your-client-id
SN_CLIENT_SECRET=your-client-secret
```

**ServiceNow setup:**

1. Navigate to **System OAuth → Application Registry**
2. Click **New** → **Create an OAuth API endpoint for external clients**
3. Set a name, note the generated **Client ID** and **Client Secret**
4. Set **Accessible from** to `All application scopes`
5. Add the values to your `.env`

---

## Example prompts

```
List all active catalog items in the "Hardware" category

Get the full definition of the "Laptop Request" catalog item, including variables and UI policies

What client scripts are on the New Employee Onboarding item?

Create a new catalog item called "VPN Access Request" with a text variable for business justification

Create a business rule on incident that sets priority to 1 when impact and urgency are both 1

Create an onLoad client script on incident that shows an info message when the priority is 1 - Critical

Create a UI policy on incident that makes caller and assignment group mandatory when priority is 1, and hides the Child Incidents related list

Create a record producer called "New Hire Equipment" that generates an sc_req_item record, with a pre-insert script that maps the selected laptop model to the item field

Create a fix script called "Backfill Incident SLAs" that queries all incidents missing an SLA and sets a default one

Run the fix script with sys_id 18f9eee1c3d1479043e1fc0d0501315e

Register an event "x_acme.contract.signed" on a custom queue, then create a script action that emails the account owner when it fires

Create an update set called "VPN Catalog Work" and make it my current set

List my in-progress update sets, then switch to "VPN Catalog Work"

Create an ATF test that submits the "VPN Access Request" catalog item and verifies the generated request record, mapping the record from the submit step into a server-side validation step
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

### Gateway headers

In gateway mode (`CREDENTIAL_PROVIDER=header`) the server trusts two headers set by the proxy in front of it. They are only meaningful behind an authenticating proxy that sets them itself and strips any client-supplied values — never expose the server directly to clients with these headers enabled.

- **`X-MCP-Access`** (security boundary) — per-request write grant. With `ACCESS_ENFORCEMENT=on`, a write tool call is denied unless the request carries this header with value `write` (default-deny, checked on every request).
- **`X-MCP-Toolsets`** (UX, not security) — comma-separated toolset names (`atf`, `business-rules`, `catalog`, `client-scripts`, `diagnostics`, `events`, `inbound-actions`, `notifications`, `records`, `script-includes`, `ui-actions`, `ui-policies`, `update-sets`), read once from the session-creating request. Only the named toolsets' tools are registered for that session, trimming the tool list the model sees. Unknown names are ignored with a warning; if the header resolves to no known toolset, all toolsets register (fail-open). This filter never denies anything — write protection is `X-MCP-Access`'s job.

---

## Roadmap

- **Multi-instance support** — named instances in config (`dev`, `staging`, `prod`), switchable per tool call or via a `switch_instance` tool
- **ITSM tools** — incident, change, problem read/write

Contributions welcome — see [CLAUDE.md](CLAUDE.md) for the architecture guide.

---

## License

[MIT](LICENSE) — Veldev, Inc.
