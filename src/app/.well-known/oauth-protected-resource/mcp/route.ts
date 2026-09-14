import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({ resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"] }, { headers: { "Cache-Control": "public, max-age=300" } });
}
