import type { NextRequest } from "next/server";

/** The pair the Streamable HTTP transport insists on seeing in Accept. */
export const MCP_ACCEPT = "application/json, text/event-stream";

/**
 * Give the Streamable HTTP transport an Accept header it will negotiate.
 *
 * The transport answers 406 unless Accept names BOTH application/json and
 * text/event-stream. A wildcard Accept, and a request with no Accept at all,
 * are clients saying they accept anything — including those two — so
 * rejecting them is wrong, and it locks out any MCP client that does not send
 * the exact pair.
 *
 * Only those two cases are rewritten. A client that names concrete types
 * keeps its own header and still receives the transport's 406 if it genuinely
 * cannot handle the response body, so this widens interoperability without
 * putting words in a client's mouth.
 */
export function withNegotiableAccept(request: NextRequest | Request): Request {
  const accept = request.headers.get("accept");
  const acceptsAnything =
    !accept?.trim()
    || accept.split(",").some((part) => part.trim().split(";")[0].trim() === "*/*");
  if (!acceptsAnything) return request;
  const headers = new Headers(request.headers);
  headers.set("accept", MCP_ACCEPT);
  return new Request(request, { headers });
}
