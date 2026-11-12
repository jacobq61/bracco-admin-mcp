# bracco-admin-mcp ops

Part of the single-operator ops platform (jacobq61/ops).

## Hosting decision: stays local

This is a **stdio** MCP server: Claude Code starts `node index.mjs` on each user's laptop and talks to it
over stdin/stdout. There is nothing listening on a port, so Cloud Run or Railway would have nothing to run.
The only hosted piece is the API it calls, bracco-social's admin-api (`src/admin-api.js`), which runs on Railway with the bot.

Moving it to Cloud Run would mean adding the Streamable HTTP transport plus per-user auth (OAuth or keys)
in front of it. Worth it only if non-technical users need it without a local Node install. Until then: local.

## Architecture

```mermaid
flowchart LR
  CC[Claude Code on a laptop] -- stdio --> MCP[bracco-admin-mcp<br/>index.mjs]
  MCP -- HTTPS + key --> API[bracco-social admin-api (`src/admin-api.js`)<br/>Railway]
  API --> DB[(SQLite)]
  BSTK[Better Stack] -- /health --> API
  BSTK --> FH[#alerts-firehose]
```

## Alert routing

| Event | Where | Source |
|---|---|---|
| API down (tools return errors) | #alerts-firehose via Better Stack HTTP check on the API's `/health` | ops repo `monitors/` |
| API errors | #kaz-ops | bracco-social logger |
| CI result on PRs | GitHub checks | `ci.yml` |

The MCP itself sends no alerts: it runs only while someone is using Claude Code.

## Secrets inventory

| Name | Where | Purpose |
|---|---|---|
| `BRACCO_ADMIN_API_URL` | each user's `claude mcp add --env` | API base URL |
| `BRACCO_ADMIN_API_KEY` | each user's `claude mcp add --env`; source of truth GCP Secret Manager, same value as bracco-social's key on Railway | API auth |
| `BRACCO_ADMIN_MCP_MODE` | user config (not a secret) | `team` (default) or `eng` (extra tools) |

Rotating the key: update Secret Manager, run `ops/secrets/sync.sh bracco-social`, then each user re-runs
`claude mcp remove` / `claude mcp add` with the new key.

## CI

`ci.yml`: install, `npm run check` (syntax), `npm test` (`scripts/smoke.mjs` starts the server over stdio with
dummy credentials and checks `tools/list`; no tool is called). Branch protection on main requires `CI / test`.

## Runbook

| Symptom | Check | Fix |
|---|---|---|
| Claude says the server failed to start | `claude mcp list`; "Missing BRACCO_ADMIN_API_URL" | Re-add with both `--env` values |
| Every tool returns 401/403 | Key rotated? | Re-add with the current key |
| Every tool times out or 5xx | Better Stack status for the API, Railway logs for bracco-social | See bracco-social `docs/OPS.md` |
| New tool missing in Claude | Old checkout | `git pull && npm install`, restart Claude Code |
