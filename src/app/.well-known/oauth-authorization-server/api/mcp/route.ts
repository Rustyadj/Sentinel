import { authorizationServerMetadata } from "@/lib/mcp/oauth";

// RFC 8414 §3.1 path-insertion form, for the resource /api/mcp.
//
// The issuer advertised in the protected-resource document is the site root,
// so the canonical metadata URL is /.well-known/oauth-authorization-server and
// a strictly conforming client finds it there. Real MCP clients don't all do
// that: several derive the metadata URL from the *resource* path and probe
// /.well-known/oauth-authorization-server/api/mcp first. That 404'd, and a
// client that doesn't fall back to the root form never learns where to
// register — it gives up before the OAuth flow starts, with nothing in any
// server log to say why.
//
// The protected-resource document already carried both forms; this is the
// matching pair for the authorization-server document.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(authorizationServerMetadata(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
