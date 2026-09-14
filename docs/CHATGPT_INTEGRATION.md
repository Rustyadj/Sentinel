# ChatGPT integration

Sentinel is exposed as an authenticated Streamable HTTP MCP server at:

`https://sentinel.srv1427612.hstgr.cloud/api/mcp`

The endpoint is deliberately not a general Sentinel REST proxy. It exposes only:

- `sentinel.route_task`
- `sentinel.get_task`
- `sentinel.cancel_task`
- `sentinel.list_agents`
- `sentinel.agent_status`
- `sentinel.memory_search`
- `sentinel.project_context`
- `sentinel.get_result`

## One-time connection setup

1. Deploy the committed migrations and application/worker services.
2. While signed in to Sentinel, register a public OAuth client at `POST /api/integrations/clients`. Use the exact redirect URI provided by the ChatGPT connection flow, and request only the scopes needed by that client.
3. In ChatGPT developer mode or the workspace app configuration, connect the remote MCP URL above. Sentinel advertises OAuth metadata at `/.well-known/oauth-authorization-server` and protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`.
4. Complete the normal Sentinel sign-in and PKCE authorization redirect.
5. Test with `List Sentinel agents`, then an async `sentinel.route_task` request.

The server is packaged in `plugins/sentinel-chatgpt/` for local Codex/plugin testing. For ChatGPT public distribution, use the current OpenAI plugin submission workflow after production OAuth, TLS, and MCP Inspector checks are complete.

## Production requirements

- Apply `prisma migrate deploy` before starting the application or orchestration worker.
- Set `REDIS_URL`; external MCP calls fail closed if the rate limiter is unavailable.
- Run `orchestration-worker` continuously. Long-running executions never rely on the MCP request remaining open.
- Configure CLI worker command, project-root allowlists, and provider credentials only in worker environment variables.
- Restrict public ingress to HTTPS. Never expose internal Hermes, Docker, database, agent configuration, or log endpoints through the MCP origin.
- Review `/api/orchestration/runs?workspaceId=<id>` as a workspace owner/admin for routing decisions, attempts, latency, validation, and errors. It excludes raw prompts, logs, OAuth tokens, and memory bodies.

## Worker contract policy

Claude Code and Codex are always dispatched as exactly one selected worker per orchestration run. Sentinel never creates a Claude Code/Codex split plan unless a future explicit task-splitting request is modeled and approved.

Hermes Lisa, Hermes Clint, and OpenClaw are discoverable today. They are not dispatch targets until each has a verified, explicitly configured task execution contract; their current registry endpoints are health-only and are not treated as an execution API.
