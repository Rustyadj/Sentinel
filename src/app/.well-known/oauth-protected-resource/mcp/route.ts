import { protectedResourceMetadata } from "@/lib/mcp/oauth";

// Compatibility alias used by MCP clients that derive a metadata URL from the
// last segment of /api/mcp. Keep it identical to the canonical document.
export function GET() {
  return Response.json(protectedResourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
