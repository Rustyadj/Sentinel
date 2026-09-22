import { NextRequest, NextResponse } from "next/server";

// Compatibility redirect for clients that cached the retired authorization
// URL. The query string (client_id, state, PKCE, scopes, resource) is retained.
export function GET(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/api/integrations/oauth/authorize";
  return NextResponse.redirect(target, 307);
}
