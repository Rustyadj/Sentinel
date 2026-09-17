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
// Each of those enforces its own, stronger check — authenticateAccessToken()
// for /api/mcp, client_id + PKCE code_verifier (+ optional secret) for the
// token endpoint — so what is removed here is only the page-oriented
// redirect, never an authorization boundary.
//
// /api/integrations/oauth/authorize is deliberately NOT excluded: that is the
// human consent screen, it calls requireUser(), and redirecting an
// unauthenticated visitor to sign-in is exactly the correct behaviour there.
export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/ready|api/version|api/rooms|api/chat|api/mcp|api/integrations/oauth/token|\\.well-known|auth|media/|_next/static|_next/image|favicon.ico).*)",
  ],
};
