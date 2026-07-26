# MCP server

Endpoint: `POST /mcp`. The route supports JSON-RPC responses and single-event
SSE responses when `Accept: text/event-stream` is requested. The optional local
stdio bridge is `node scripts/sentinel-mcp-stdio.mjs`.

Credentials are short-lived `sentinel_mcp_*` bearer values. Only a prefix and a
peppered SHA-256 hash are stored. Each client binds an acting user and optional
organization/workspace/project, tool scopes, origins, trust level (0-3), rate
limit, cost ceiling, expiry, and revocation state. Mutation tools require an
idempotency key. Reuse with different input is rejected.

Handlers call existing authorization, approval, audit, knowledge, workflow, and
delegation services. Shell, SQL, permission editing, secret rotation, production
deployment/restart/rollback, financial operations, destructive workspace or
project deletion, and self-approval are not exposed.

Production requires TLS at the reverse proxy. OAuth 2.1 is planned; short-lived
service credentials are the functional authentication mode in this phase.
