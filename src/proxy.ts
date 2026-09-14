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
// The MCP control plane is the same problem seen from outside the box:
//
//   * `.well-known/oauth-*` are OAuth discovery documents. The spec requires
//     them to be publicly readable — an MCP client fetches them *before* it
//     holds any credential. Redirecting them to a sign-in page makes external
//     discovery fail with nothing but "could not connect".
//   * `api/mcp` authenticates itself with a bearer access token and answers an
//     unauthenticated request with 401 + WWW-Authenticate, which is the
//     challenge that points the client at discovery in the first place. A 307
//     to HTML destroys that handshake.
//   * `api/integrations/oauth/token` is a machine-to-machine PKCE exchange
//     that carries no session cookie, and `api/integrations/clients`
//     self-authenticates via requireUser() and returns a JSON 401.
//
// `api/integrations/oauth/authorize` is deliberately NOT excluded: it is the
// interactive consent step, so an unauthenticated visitor *should* be sent to
// the sign-in page and returned here afterwards.
export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/ready|api/version|api/rooms|api/chat|api/mcp|api/integrations/oauth/token|api/integrations/clients|\\.well-known|auth|media/|_next/static|_next/image|favicon.ico).*)",
  ],
};
