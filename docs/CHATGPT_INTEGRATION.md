# ChatGPT integration

Sentinel is exposed as an authenticated Streamable HTTP MCP server at:

`https://sentinel.srv1427612.hstgr.cloud/api/mcp`

The endpoint is deliberately not a general Sentinel REST proxy. It exposes only:

- `sentinel.route_task`
- `sentinel.get_task`
- `sentinel.get_result`
- `sentinel.cancel_task`
- `sentinel.capabilities`
- `sentinel.profile`
- `sentinel.list_agents`
- `sentinel.agent_status`
- `sentinel.memory_search`
- `sentinel.project_context`

It also exposes two read-only, authenticated resources: `sentinel://context`
and `sentinel://capabilities`.

## One-time connection setup

1. Deploy the committed migrations plus the application and `orchestration-worker` services.
2. In ChatGPT developer mode or the workspace app configuration, connect the remote MCP URL above. Sentinel advertises OAuth metadata at `/.well-known/oauth-authorization-server`, protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, and RFC 7591 dynamic client registration at `/api/integrations/oauth/register`.
3. Complete Sentinel sign-in, review the requested scopes, and approve the PKCE authorization request. Access tokens are resource-bound; refresh tokens rotate and replay revokes their family.
4. Call `sentinel.project_context`. A sole permitted project is selected deterministically; ambiguous access returns only permitted choices and requires an explicit `projectId` or `workspaceId`.
5. Test `sentinel.memory_search`, then an async `sentinel.route_task`, followed by `sentinel.get_task` and `sentinel.get_result`.

The server is packaged in `plugins/sentinel-chatgpt/` for local Codex/plugin testing. For ChatGPT public distribution, use the current OpenAI plugin submission workflow after production OAuth, TLS, and MCP Inspector checks are complete.

## Production requirements

- Apply `prisma migrate deploy` before starting the application or orchestration worker.
- Set `REDIS_URL`; external MCP calls fail closed if the rate limiter is unavailable.
- Set `AUTH_URL` to the exact public HTTPS Sentinel origin. Discovery never intentionally advertises an internal container host.
- Keep the reverse proxy request timeout above the 25-second synchronous MCP wait, or use async tasks (recommended). Streamable HTTP uses stateless JSON responses; durable execution does not depend on reconnecting to an old HTTP session.
- Run `orchestration-worker` continuously. Long-running executions never rely on the MCP request remaining open.
- Configure CLI worker command, project-root allowlists, and provider credentials only in worker environment variables.
- Restrict public ingress to HTTPS. Never expose internal Hermes, Docker, database, agent configuration, or log endpoints through the MCP origin.
- Review `/api/orchestration/runs?workspaceId=<id>` as a workspace owner/admin for routing decisions, attempts, latency, validation, and errors. It excludes raw prompts, logs, OAuth tokens, and memory bodies.

## Verification

- Discovery-only production check: `npm run probe:mcp:production`
- Full external-client test: `node scripts/mcp-live-probe.mjs --base https://sentinel.srv1427612.hstgr.cloud`. This uses public DCR/OAuth/MCP only, pauses for real human consent, retrieves governed memory, dispatches a real runtime task, validates ownership and result handling, and tests refresh rotation. It never prints tokens.
- To prove authenticated cross-user isolation, supply `MCP_PROBE_FOREIGN_TOKEN` for a second Sentinel user. Optional expired/revoked fixtures are `MCP_PROBE_EXPIRED_TOKEN` and `MCP_PROBE_REVOKED_TOKEN`.

## Worker contract policy

Claude Code and Codex are always dispatched as exactly one selected worker per orchestration run. Sentinel never creates a Claude Code/Codex split plan unless a future explicit task-splitting request is modeled and approved.

Sentinel dispatches only through the canonical runtime adapter layer: Hermes Lisa and Hermes Nathan2 use the Hermes WebSocket JSON-RPC adapter, OpenClaw uses its gateway adapter, and Codex/Claude Code use their runtime adapters. Nathan2 remains registered and reachable but is not execution-verified until its gateway authentication succeeds. OpenClaw's raw terminal passthrough is never an MCP execution path.
