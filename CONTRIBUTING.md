# Contributing

Thanks for your interest in improving the Veldev ServiceNow MCP server.
Contributions of all sizes are welcome.

## Before you start

For anything beyond a small fix, **open an issue first** to discuss the approach —
it saves everyone time. For bugs, include your ServiceNow version, the transport
you're using (`http` / `stdio`), and steps to reproduce.

## Setup

```bash
git clone https://github.com/dariomba/veldev-servicenow-mcp.git
cd veldev-servicenow-mcp
npm install
cp .env.example .env   # point it at a THROWAWAY ServiceNow PDI, never production
```

Get a free Personal Developer Instance at
[developer.servicenow.com](https://developer.servicenow.com).

## Development loop

```bash
npm run dev          # hot reload (tsx watch)
npm test             # vitest
npx tsc --noEmit     # type-check — must be clean
npm run lint         # Biome
```

All four must pass before a PR is merged (CI enforces tsc + lint + tests).

### Verifying tools against a live instance

Unit tests use recorded fixtures and never hit ServiceNow. They prove a tool's
shape and logic, **but not live API behaviour** — only a real call can do that.
After adding or changing a tool, exercise it against your PDI (connect an MCP
client, or use the `.mcp.json` with Claude Code) and confirm the output is
correct: human-readable summaries are accurate, reference fields resolve to
display names, and errors return useful messages. See [CLAUDE.md](CLAUDE.md) for
the architecture and the tool-authoring conventions.

## Adding a tool

See the "Adding a tool" section in [CLAUDE.md](CLAUDE.md). In short: add a
file under `src/tools/<domain>/` and wire it in that domain's `index.ts` (or
create a new domain folder and register its `register<Domain>Tools` in
`buildServer()` in `src/server.ts`), add a colocated `*.test.ts`, and write the
tool description for the model (say *when* to use it and what format inputs
take).

## Pull requests

- Keep PRs focused — one concern per PR.
- Match the existing code style (Biome handles formatting).
- Add or update tests for any behaviour change.
- Describe what changed and how you verified it.

## Code of conduct

Be respectful and constructive. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/).
