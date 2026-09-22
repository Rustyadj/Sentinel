# External MCP Gateway

Sentinel exposes a remote **MCP server** that external clients — ChatGPT connectors
first — call over Streamable HTTP. External clients hold no Sentinel session cookie,
so they authenticate with OAuth 2.1 (authorization code + PKCE, dynamic client
registration), and every tool call is gated on the scopes a human consented to.

## Endpoints

| Path | Purpose |
|------|---------|
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata. Unauthenticated. |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata; what the 401 points at. |
| `/api/mcp/oauth/register` | RFC 7591 dynamic client registration. |
| `/mcp/authorize` | Human consent screen (workspace + scope selection). |
| `/api/mcp/oauth/consent` | Where the consent form posts; mints the code. |
| `/api/mcp/oauth/token` | `authorization_code` and `refresh_token` grants. |
| `/api/mcp/oauth/revoke` | RFC 7009 revocation. |
| `/api/mcp` | The MCP endpoint. `POST` only, bearer token required. |

## Flow

```
ChatGPT                         Sentinel
   │  GET /.well-known/oauth-authorization-server
   │─────────────────────────────────────────────▶
   │  POST /api/mcp/oauth/register                  (no auth; grants nothing)
   │─────────────────────────────────────────────▶  client_id
   │  browser → /mcp/authorize?...&code_challenge=  (human signs in, picks
   │─────────────────────────────────────────────▶   workspace + scopes)
   │  ◀── 303 to redirect_uri?code=…&state=…
   │  POST /api/mcp/oauth/token  (code + code_verifier)
   │─────────────────────────────────────────────▶  access + refresh token
   │  POST /api/mcp  Authorization: Bearer …
   │─────────────────────────────────────────────▶  initialize / tools/list / tools/call
```

## Authorization model

- **Registration grants nothing.** A registered client reads no data until a
  signed-in human approves it. The scopes at registration are only a *ceiling*.
  A client that registers without naming scopes — which is what ChatGPT does —
  gets the full scope list as its ceiling. That is not a grant: the consent
  screen offers the ceiling, and only what the human ticks becomes real.
- **The ceiling and the pre-ticked set are different things.** `DEFAULT_CLIENT_SCOPES`
  is the former, `PRE_TICKED_SCOPES` the latter, and they are separate constants
  on purpose. When they were one constant, an unscoped registration capped at
  read-only, and because the consent screen can only ever offer the ceiling,
  `sentinel:tasks.write` was unreachable — `sentinel_create_task` could not be
  approved or even displayed, whatever the human wanted.
- **Consent is per-workspace.** A grant is bound to one workspace, and every tool
  read is filtered by it. A grant with no workspace sees nothing — the gateway
  fails closed rather than falling back to "everything".
- **Workspace membership is live.** Sentinel re-checks ownership or an active
  role assignment on every MCP request. Removing a user's workspace access
  immediately disables that connector grant, even before token expiry.
- **Write scopes are never pre-ticked** on the consent screen. Read is the default;
  creating tasks is an explicit act by the human.
- **Scopes are checked twice.** `tools/list` hides tools outside the grant, and
  `tools/call` re-checks — a client can call a name it was never shown.
- **Revocation is immediate.** Access tokens are stateless but carry their grant id,
  and the grant is loaded on every request. Revoking kills every outstanding token.

### Scopes

| Scope | Grants |
|-------|--------|
| `sentinel:workspace.read` | Workspace metadata and cross-domain counts |
| `sentinel:agents.read` | List agents and their roles |
| `sentinel:memories.read` | Read memories |
| `sentinel:tasks.read` | Read tasks |
| `sentinel:tasks.write` | Create tasks |
| `sentinel:content.read` | Browse 30 workspace-scoped record classes across projects/content, organization/security, collaboration, knowledge, governed learning, and agent runtime/workspace inventory |
| `sentinel:search.read` | `search` / `fetch` across all readable workspace content |

## Tools

`search` and `fetch` are named exactly as ChatGPT's deep-research connector contract
requires: `search` returns `{id, title, url}` results, and `fetch` resolves one id to
full text. Search covers every supported workspace record type, not only tasks and
memories. Direct-id fetches repeat the workspace filter, so knowing another tenant's
id is not enough to read it.

The richer surface is:

- `sentinel_workspace_overview` — workspace identity and counts by domain.
- `sentinel_list_content` — browse one of 30 workspace-scoped record classes.
- `sentinel_list_agents`, `sentinel_search_memories`, `sentinel_list_tasks`.
- `sentinel_create_task` — the sole write tool; it has write annotations and a
  separate scope that is not pre-selected during consent.

Every tool advertises MCP safety annotations (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, and `openWorldHint`) so ChatGPT can distinguish reads from writes.

## OAuth 2.1 positions taken

- PKCE `S256` is mandatory; `plain` is rejected (removed in OAuth 2.1).
- Redirect URIs match **exactly** — no prefix or wildcard matching.
- Registration refuses plaintext `http` redirect URIs except on loopback.
- Authorization codes are single-use, hashed at rest, and expire in 60s.
  Redemption is an atomic compare-and-set, so a replay fails rather than races.
- Refresh tokens rotate on every use and are stored only as SHA-256.
- A code redeemed by a client other than the one it was issued to is refused.
- ChatGPT's OAuth `resource` parameter is validated and access tokens carry an
  `aud` bound to the public `/api/mcp` URL, preventing cross-resource replay.

## Configuration

| Variable | Required | Notes |
|----------|----------|-------|
| `MCP_GATEWAY_ISSUER` | yes in prod | Public origin, e.g. `https://sentinel.example`. Falls back to `NEXTAUTH_URL`, then `APP_URL`. Must be the externally reachable URL — it is what goes into the discovery documents. |
| `AUTH_SECRET` | yes | Already set for NextAuth; also signs MCP access tokens. |

## Testing

```bash
# Hermetic: full OAuth → tool-call path against an in-memory store. No DB, no network.
npx vitest run tests/mcp/gateway.test.ts

# Live, against a deployed host (two passes — consent needs a browser):
node scripts/mcp-smoke.mjs --base https://sentinel.example
node scripts/mcp-smoke.mjs --code <code-from-the-redirect>
```

## Deployment notes

- The migration `20260917000000_mcp_gateway` is purely additive: three new
  tables, indexes, and foreign keys, with no changes to existing tables or data.
  Run it through the normal `prisma migrate deploy` release step.
- `MCP_GATEWAY_ISSUER` must be set before a connector is added. The discovery
  documents are generated from it, and ChatGPT caches them.
- `/api/mcp` is deliberately not behind middleware — it authenticates itself.
