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
export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/ready|api/version|api/rooms|api/chat|auth|media/|_next/static|_next/image|favicon.ico).*)",
  ],
};
