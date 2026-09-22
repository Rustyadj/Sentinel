# Architecture Decision Records

Newest first. One entry per significant technical choice: the decision, why, and
what was rejected. No implementation detail — that belongs in the topic doc.

## ADR-002 — An unscoped client registration ceilings at every scope, not read-only

**Date:** 2026-09-22
**Status:** Accepted

**Decision.** When a client registers without naming scopes, its ceiling is the
full scope list. The set that arrives pre-ticked on the consent screen stays
read-only, and the two now live in separate constants (`DEFAULT_CLIENT_SCOPES`
vs `PRE_TICKED_SCOPES`). See [MCP_GATEWAY.md](MCP_GATEWAY.md).

**Why.**
- ChatGPT's dynamic registration sends no `scope`. Under the old shared
  constant its ceiling came out read-only, and since the consent screen can
  only offer the ceiling, `sentinel:tasks.write` was never displayed and never
  grantable. `sentinel_create_task` was unreachable by construction — a
  capability the operator believed was shipped but no human could switch on.
- A ceiling is not a grant. ADR-001 already established that registration
  grants nothing; widening it moves no authority, because every scope still
  has to be ticked by a signed-in human for one named workspace.
- Splitting the constants makes the conflation unrepeatable: widening what a
  client *may* ask for can no longer quietly widen what a human is nudged to
  approve.

**Rejected.**
- *Pre-ticking write once the ceiling widened.* That would trade a capability
  bug for a consent bug — the human would grant task creation by not reading.
- *Special-casing ChatGPT's client name at registration.* Tools are gated on
  scopes, never on client identity; an allowlist of names would reintroduce
  exactly the coupling the scope model exists to avoid.
- *Telling operators to pre-register ChatGPT with an explicit scope string.*
  Defeats dynamic registration, and silently fails open to read-only for
  anyone who skips the step.

**Consequences.** No migration and no token format change. Existing grants are
unaffected; clients registered before this keep their stored read-only ceiling
and must re-register (in ChatGPT, remove and re-add the connector) to be
offered write.

## ADR-001 — External MCP gateway authenticates with OAuth 2.1, not a shared token

**Date:** 2026-09-17
**Status:** Accepted

**Decision.** Sentinel acts as an MCP *server*. External clients (ChatGPT first)
authenticate with OAuth 2.1 — authorization code + PKCE S256, dynamic client
registration, rotating refresh tokens — and every tool call is gated on scopes a
human consented to for one specific workspace. See [MCP_GATEWAY.md](MCP_GATEWAY.md).

**Why.**
- ChatGPT connectors expect discovery + OAuth; a static token would require every
  user to hand-copy a secret, and there is no consent step to scope it.
- Scopes make the blast radius a decision the human makes, not a property of the
  deployment. A connector can be given search without ever being able to write.
- Per-grant revocation is immediate because access tokens carry their grant id and
  the grant is loaded on every request.

**Rejected.**
- *Static bearer token with a scope list* (the `avraxeai-gateway-secret` pattern
  used for the agent gateway). Faster to ship, but single-tenant in practice, no
  per-client revocation, and no consent surface — the operator, not the data owner,
  would be deciding what an external LLM may read.
- *Reusing the mobile bearer token.* It identifies a user with full app authority;
  handing that to a third-party connector is the opposite of scoping.
- *Sentinel as MCP client instead.* A different product, not this one: the ask was
  to expose Sentinel's tools outward.

**Consequences.** Three additive tables (`mcp_clients`, `mcp_auth_codes`,
`mcp_grants`), a consent page at `/mcp/authorize`, and `MCP_GATEWAY_ISSUER` as a
new required production variable. The OAuth logic is written against an `McpStore`
interface so the end-to-end test runs with no database.
