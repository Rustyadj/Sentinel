import { handleMcp } from "@/lib/mcp/gateway";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = Number(process.env.MCP_MAX_BODY_BYTES ?? 1_000_000);

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "MCP request too large." }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return Response.json({ error: "MCP request too large." }, { status: 413 });
  let body: Parameters<typeof handleMcp>[1];
  try { body = JSON.parse(raw); }
  catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { status: 400 }); }
  const result = await handleMcp(request, body);
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    });
  }
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

export function GET() {
  return Response.json({ error: "Use authenticated Streamable HTTP POST for MCP JSON-RPC requests." }, { status: 405, headers: { Allow: "POST" } });
}
