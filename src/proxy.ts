import { auth } from "@/auth";

// Next.js 16 renames middleware → proxy
export const proxy = auth;

// This gate is for *pages*: an unauthenticated visitor should land on the
// sign-in screen, not a bare 401. API routes are excluded on purpose — they
// each call requireUser()/requireApiUser() themselves and return a proper
// JSON 401, which is what a fetch caller (mobile app, voice worker,
// programmatic client) needs. Routing an unauthenticated API request through
// this gate instead means it 307-redirects to an HTML sign-in page: no
// session cookie is established by that (the visitor never sees it), so
// mobile's bearer-token requests were rejected before requireApiUser ever
// got to inspect the Authorization header, and the voice worker's
// VOICE_WORKER_SECRET-authenticated call into /api/chat hit the exact same
// dead end. api/auth/health/ready/version were already carved out for the
// same reason; api/rooms and api/chat join them here.
//
// The external MCP gateway is that same failure mode once more, and the one
// place it is fatal rather than merely inconvenient. An MCP client (ChatGPT)
// authenticates with an OAuth bearer token and never holds a session cookie,
// so routing it through this gate turns three things into an HTML sign-in
// page:
//   - /.well-known/*  discovery. These must be anonymous by definition: a
//     client that cannot read them cannot even find the token endpoint.
//   - /api/mcp        must answer 401 + WWW-Authenticate so the client knows
//     to begin the OAuth flow. A 307 tells it nothing.
//   - /api/integrations/oauth/token  the code-for-token exchange is
//     unauthenticated by design; gating it makes the flow unclosable.
//   - /api/integrations/oauth/register  RFC 7591 dynamic client registration.
//     A client registers precisely because it has no credentials yet; it
//     confers no access, since consent still runs through /authorize.
// Each of those enforces its own, stronger check — authenticateAccessToken()
// for /api/mcp, client_id + PKCE code_verifier (+ optional secret) for the
// token endpoint — so what is removed here is only the page-oriented
// redirect, never an authorization boundary.
//
// /api/integrations/oauth/authorize is deliberately NOT excluded: that is the
// human consent screen, it calls requireUser(), and redirecting an
// unauthenticated visitor to sign-in is exactly the correct behaviour there.
// /mcp/authorize is the workspace-scoped connector consent screen and performs
// its own session check while preserving the OAuth and PKCE query parameters.
//
// api/voice is excluded for the same reason, and it matters most mid-call:
// every voice route calls requireUser() itself and returns a JSON 401, but
// routed through this gate a request with a lapsed session gets a 307 that
// fetch silently follows to an HTML sign-in page. The tool call then reads as
// "the server sent something unparseable" rather than "you are signed out",
// so a live conversation reports a mysterious failure instead of asking the
// user to sign in again.
//
// The exclusion is `mcp/` and bare `mcp`, not just `mcp/authorize`, because
// /mcp is itself an MCP endpoint — the conventional mount point, aliasing
// /api/mcp. Listing only the consent page left POST /mcp being answered with a
// 307 to an HTML sign-in form: no 401, no WWW-Authenticate, nothing pointing
// at the OAuth metadata. A connector given that URL cannot discover how to
// authenticate and simply gives up, leaving no trace server-side — the same
// bug this comment block already described three times over, hit once more by
// the one path nobody had listed.
export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/ready|api/version|api/rooms|api/chat|api/mcp|api/voice|api/integrations/oauth/token|api/integrations/oauth/register|\\.well-known|mcp(?:/|$)|auth|media/|_next/static|_next/image|favicon.ico).*)",
  ],
};
