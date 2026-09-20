import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/integrations/public-origin";

export function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"],
    bearer_methods_supported: ["header"],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
