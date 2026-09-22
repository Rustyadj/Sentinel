/**
 * A deliberately small access log for the external MCP surface.
 *
 * Traefik keeps no access log here and Next logs no requests, so when a
 * connector walked away mid-handshake there was nothing at all to look at —
 * the only way anyone had found to see a real client's requests was to packet
 * capture port 3000, which sweeps up bearer tokens for the privilege. This
 * exists so that is never the first resort again.
 *
 * What it records is the shape of the handshake, never its secrets: method,
 * path, the JSON-RPC method name, the client's user-agent, and an outcome.
 * No Authorization header, no tokens, no codes, no tool arguments, no results.
 */
const PREFIX = "[mcp]";

/** Truncated, and stripped of anything that could carry a credential. */
function ua(request: Request): string {
  return (request.headers.get("user-agent") ?? "-").slice(0, 120);
}

export function logDiscovery(request: Request, path: string): void {
  console.log(`${PREFIX} discovery ${path} ua=${JSON.stringify(ua(request))}`);
}

export function logGateway(
  request: Request,
  detail: { rpcMethod?: string | null; outcome: string; status: number },
): void {
  const method = detail.rpcMethod ? ` rpc=${detail.rpcMethod}` : "";
  console.log(
    `${PREFIX} ${request.method} /api/mcp${method} -> ${detail.status} ${detail.outcome} ua=${JSON.stringify(ua(request))}`,
  );
}
