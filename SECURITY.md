# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report them privately via [GitHub Security Advisories](https://github.com/dariomba/veldev-servicenow-mcp/security/advisories/new),
or by email to **veldev@veldev-ai.com**. We aim to acknowledge reports within a few
business days.

When reporting, please include: a description of the issue, steps to reproduce,
and the potential impact.

## Security model

This server connects an MCP client to a ServiceNow instance. A few things worth
understanding before you deploy it:

- **Credentials are never persisted.** ServiceNow credentials are read from the
  environment (or, in `header` mode, from per-request headers) and used only for
  the lifetime of a request. They are not written to disk, logs, or any database.
- **Never commit `.env`.** It is gitignored. It holds your ServiceNow URL,
  username, and password — treat it like any other secret.
- **Basic auth sends credentials to your instance.** With the default basic-auth
  mode, the username/password are sent (over HTTPS) to your ServiceNow instance
  on every Table API call. Use an account with the least privilege needed.
- **The HTTP transport has no built-in authentication.** If you expose
  `TRANSPORT=http` publicly, put it behind your own auth layer (reverse proxy,
  gateway). `CREDENTIAL_PROVIDER=header` + `GATEWAY_SECRET` exists for exactly
  this: a trusted gateway injects credentials and the server rejects requests
  without the shared secret. Do **not** expose the raw HTTP server to the
  internet unprotected.
- **Use a throwaway PDI for development**, never a production or shared instance.

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest release on
`main`.
