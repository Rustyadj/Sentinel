import { NextRequest, NextResponse } from "next/server";

// Preserve the POST body while sending stale consent forms to the canonical
// SDK-backed OAuth authorization endpoint.
export function POST(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/api/integrations/oauth/authorize";
  return NextResponse.redirect(target, 308);
}
