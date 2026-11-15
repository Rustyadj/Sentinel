import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isPublicAddress, publicOnlyLookup } from "./public-address";

/** The `fetch` signature transports accept (matches the MCP SDK's `FetchLike`). */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface PublicOnlyFetchOptions {
  /** Resolver used for every connection. Defaults to `publicOnlyLookup`; tests may wrap it. */
  lookup?: LookupFunction;
  /** Redirect hops followed when `init.redirect` is "follow" (the default). */
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
/** Dropped when a redirect leaves the original origin, as browsers do. */
const ORIGIN_BOUND_HEADERS = ["authorization", "cookie", "proxy-authorization"];

class PublicFetchRefused extends TypeError {
  constructor(message: string) { super(`fetch refused: ${message}`); this.name = "PublicFetchRefused"; }
}

/**
 * Hosts that never reach `lookup` (IP literals) are checked here; every other
 * host is checked by `lookup` on the connection itself, so the address that is
 * validated is the address that is connected to — there is no second resolution
 * for a short-TTL name to rebind between.
 */
function assertFetchableUrl(url: URL): void {
  if (url.protocol !== "https:") throw new PublicFetchRefused(`${url.protocol} is not allowed, only https`);
  if (url.username || url.password) throw new PublicFetchRefused("url must not embed credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new PublicFetchRefused(`${host} is not a public address`);
}

async function encodeBody(body: RequestInit["body"]): Promise<Buffer | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from(await new Response(body).arrayBuffer());
}

function toResponse(res: IncomingMessage, method: string, url: URL): Response {
  const headers = new Headers();
  for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
  const status = res.statusCode ?? 502;
  const hasBody = method !== "HEAD" && !NULL_BODY_STATUSES.has(status);
  if (!hasBody) res.resume();
  const body = hasBody ? (Readable.toWeb(res) as ReadableStream<Uint8Array>) : null;
  const response = new Response(body, { status, statusText: res.statusMessage ?? "", headers });
  Object.defineProperty(response, "url", { value: url.toString() });
  return response;
}

function send(url: URL, method: string, headers: Headers, body: Buffer | undefined, signal: AbortSignal | undefined, lookup: LookupFunction): Promise<IncomingMessage> {
  const outgoing: Record<string, string> = {};
  headers.forEach((value, key) => { outgoing[key] = value; });
  if (body) outgoing["content-length"] = String(body.length);
  const options: RequestOptions = { method, headers: outgoing, lookup, signal: signal ?? undefined };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, options, resolve);
    req.on("error", (error) => reject(signal?.aborted ? signal.reason : new TypeError(`fetch failed: ${error.message}`, { cause: error })));
    req.end(body);
  });
}

/**
 * A `fetch` replacement for server-side requests to user-supplied URLs (an SSRF
 * vector). It speaks https only, connects only to public addresses — checked on
 * the socket's own DNS answer, not a separate lookup — and re-applies both rules
 * to every redirect hop, stripping credentials when a hop changes origin.
 */
export function createPublicOnlyFetch(options: PublicOnlyFetchOptions = {}): FetchLike {
  const lookup = options.lookup ?? publicOnlyLookup;
  const maxRedirects = options.maxRedirects ?? 5;

  return async function publicOnlyFetch(input, init = {}) {
    let url = new URL(input instanceof URL ? input.href : input);
    let method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    let body = await encodeBody(init.body);
    const redirectMode = init.redirect ?? "follow";

    for (let hop = 0; ; hop += 1) {
      assertFetchableUrl(url);
      const res = await send(url, method, headers, body, init.signal ?? undefined, lookup);
      const location = res.headers.location;
      if (!REDIRECT_STATUSES.has(res.statusCode ?? 0) || !location || redirectMode === "manual") return toResponse(res, method, url);
      res.resume();
      if (redirectMode === "error") throw new TypeError(`fetch failed: redirect to ${location} not allowed`);
      if (hop >= maxRedirects) throw new TypeError("fetch failed: too many redirects");

      const next = new URL(location, url);
      if (next.origin !== url.origin) for (const name of ORIGIN_BOUND_HEADERS) headers.delete(name);
      const status = res.statusCode ?? 0;
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        if (method !== "HEAD") method = "GET";
        body = undefined;
        headers.delete("content-type");
      }
      url = next;
    }
  };
}

/** Shared instance for callers that need no options. */
export const publicOnlyFetch: FetchLike = createPublicOnlyFetch();
