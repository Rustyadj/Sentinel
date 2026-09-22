// The retired gateway advertised this endpoint. It intentionally issues no
// tokens now; clients must reconnect through the canonical OAuth metadata.
export function POST() {
  return Response.json({
    error: "invalid_request",
    error_description: "This legacy endpoint is retired. Reconnect using /.well-known/oauth-authorization-server.",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
