// CORS for the mobile-facing API surface only (login + the three routes it
// gates: rooms, room messages, chat). These are bearer-token authenticated,
// not cookie-authenticated — a cross-origin page has no ambient credential
// to ride along automatically, so it can only get a response back if it
// already has the user's token and attaches it itself. That's the same
// trust boundary a same-origin caller has, which is why a permissive
// wildcard origin is safe here in a way it would NOT be for a
// cookie-authenticated route (where it would open the door to CSRF).
//
// The immediate reason this exists: `expo start --web` runs the app in a
// real browser on its own dev-server origin, and a real browser enforces
// CORS even though the shipped native app (iOS/Android) never will — so
// without this, the web target of local development is blocked while the
// actual target platform is unaffected either way.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withMobileCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}
