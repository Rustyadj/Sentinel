# MCP ingress — getting an external client to Sentinel

Codex owns the MCP server implementation (`src/app/api/mcp/route.ts`,
`src/lib/integrations/*`). This document owns everything in front of it: TLS,
routing, proxy behaviour, and the procedure for connecting an external client
such as ChatGPT.

## Public surface

| Property | Value |
|---|---|
| MCP endpoint | `https://sentinel.srv1427612.hstgr.cloud/api/mcp` |
| Transport | MCP streamable HTTP (JSON-RPC over POST; GET for the stream; DELETE to end a session) |
| TLS | Terminated at Traefik, Let's Encrypt (`certResolver: letsencrypt`) |
| Authentication | OAuth 2.1 authorization-code + PKCE (S256), bearer access token |
| Protected-resource metadata | `/.well-known/oauth-protected-resource/mcp` |
| Authorization-server metadata | `/.well-known/oauth-authorization-server` |
| Authorize / token | `/api/integrations/oauth/authorize`, `/api/integrations/oauth/token` |
| Scopes | `sentinel.read`, `sentinel.tasks.read`, `sentinel.tasks.write`, `sentinel.memory.read` |

Internal container ports are **not** published. Compose binds the app to
`127.0.0.1:3000`; Traefik is the only ingress and the only TLS terminator.

## Why the discovery documents must be public

`/api/mcp` answers an unauthenticated request with `401` and:

    WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"

The client follows that URL, then the authorization-server document, then runs
the authorize/token exchange. If any of those three is redirected to the HTML
sign-in page, discovery fails and the client reports only "could not connect".

Both documents build `issuer` and `resource` from the **inbound request
origin** (`request.nextUrl.origin`). Behind a proxy that origin comes from the
forwarded host and protocol, which is why the router attaches
`sentinel-forwarded` (`X-Forwarded-Proto: https`, `passHostHeader: true`). With
those missing, Sentinel would advertise an `http://` or `localhost` issuer and
every external client would fail even though the endpoint itself is reachable.

## Proxy behaviour

* **No buffering.** Traefik does not buffer unless a `buffering` middleware is
  attached; none is, deliberately. A buffering middleware would hold the whole
  MCP response until completion and break incremental streaming.
* **No compression** on the MCP router — compressing an event stream defeats
  incremental delivery.
* **Timeouts.** `sentinel-mcp-transport` sets `responseHeaderTimeout: 0s` and
  `idleConnTimeout: 300s` so a long agent execution streaming back through MCP
  is not cut off mid-run.
* **No caching.** `Cache-Control: no-store` on the response: a bearer-token
  JSON-RPC endpoint and an auth challenge must never be cached by an
  intermediary.
* **Authentication is not weakened anywhere in the path.** Traefik forwards the
  `Authorization` header unchanged; it does not terminate, inspect, or
  substitute it. Every request is authenticated in the application by
  `authenticateAccessToken`, and rate-limited per client+user before the MCP
  server is constructed.

## Apply procedure (not yet performed — see "Deployment status")

1. Back up the live file:
   `cp /etc/traefik/dynamic/sentinel.yml /etc/traefik/dynamic/sentinel.yml.bak-$(date +%Y%m%d-%H%M%S)`
2. Copy `deploy/traefik/sentinel.yml` to `/etc/traefik/dynamic/sentinel.yml`.
   Traefik watches this directory and reloads without a restart.
3. Confirm the router loaded: `docker logs traefik-traefik-1 --since 1m | grep -i error`
4. Verify from a machine that is **not** this VPS (see below).

## External verification

These must be run from outside the host. The VPS cannot reach its own public
address (NAT hairpin is blocked there), so a probe run on the VPS is not
evidence of external reachability.

    HOST=https://sentinel.srv1427612.hstgr.cloud

    # 1. discovery documents are public and correct
    curl -sS $HOST/.well-known/oauth-protected-resource/mcp | jq
    curl -sS $HOST/.well-known/oauth-authorization-server   | jq
    #    issuer/resource must be https://sentinel.srv1427612.hstgr.cloud

    # 2. authentication is enforced, and the challenge points at discovery
    curl -sS -i -X POST $HOST/api/mcp \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -20
    #    expect: 401 + WWW-Authenticate: Bearer resource_metadata="..."

    # 3. a bad token is rejected
    curl -sS -o /dev/null -w '%{http_code}\n' -X POST $HOST/api/mcp \
      -H 'authorization: Bearer not-a-real-token' \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
    #    expect: 401

    # 4. with a real token, discovery of capabilities
    curl -sS -X POST $HOST/api/mcp \
      -H "authorization: Bearer $TOKEN" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'

## Connecting ChatGPT

1. Register a client row (`/api/integrations/clients`) with the redirect URI
   ChatGPT gives you and the scopes it should hold. Grant the narrowest set
   that the intended use needs — `sentinel.read` alone for read-only use.
2. In ChatGPT, add a connector pointing at
   `https://sentinel.srv1427612.hstgr.cloud/api/mcp`.
3. ChatGPT performs discovery and the PKCE authorization-code exchange itself.
   Approve the consent screen as the Sentinel user the connector should act as —
   the token is bound to that user, and every MCP call is audited under them
   (`mcp.invocation`).

## Deployment status

Nothing here has been applied. The live `/etc/traefik/dynamic/sentinel.yml`
still contains the OpenClaw legacy router, and the deployed application image
predates the MCP routes — `/api/mcp` and both `.well-known` paths currently
answer `307` to the sign-in page because those route handlers do not exist in
the running build, not because of a proxy or middleware problem.
