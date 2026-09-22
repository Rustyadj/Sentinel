# Architecture Decision Records

Newest first. One entry per significant technical choice: the decision, why, and
what was rejected. No implementation detail — that belongs in the topic doc.

## ADR-001 — External MCP gateway authenticates with OAuth 2.1, not a shared token

**Date:** 2026-09-17
**Status:** Accepted

**Decision.** Sentinel acts as an MCP *server*. External clients (ChatGPT first)
authenticate with OAuth 2.1 — authorization code + PKCE S256, dynamic client
registration, rotating refresh tokens — and every tool call is gated on scopes a
human consented to for their Sentinel identity. See
[CHATGPT_INTEGRATION.md](CHATGPT_INTEGRATION.md).

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

**Consequences.** The SDK-backed server at `/api/mcp` and the OAuth implementation
under `/api/integrations/oauth/*` are the canonical public surface. `AUTH_URL`
defines the trusted public origin. Legacy `/api/mcp/oauth/*` and `/mcp/authorize`
URLs are compatibility aliases only and contain no independent protocol logic.
