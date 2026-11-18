// The one place Sentinel opens a connection to a server a guest named.
//
// Deliberately not `fetch`: this needs the DNS answer checked on the very
// connection that uses it (see publicOnlyLookup), redirects refused rather
// than followed, and a hard cap on how much is read. Nothing here carries a
// Sentinel credential other than the per-agent token the caller passes.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPublicAddress, publicOnlyLookup } from "@/lib/net/public-address";

export class OutsideAgentError extends Error {
  constructor(message: string, readonly code: OutsideAgentErrorCode, readonly status = 502) {
    super(message);
    this.name = "OutsideAgentError";
  }
}

export type OutsideAgentErrorCode =
  | "url_invalid"
  | "url_not_public"
  | "unreachable"
  | "timed_out"
  | "too_large"
  | "bad_status"
  | "unauthorized"
  | "bad_response"
  | "agent_failed"
  | "protocol_unsupported";

/**
 * Lets a developer connect an agent on their own machine. Ignored in a
 * production build, so a stray setting cannot turn the address rules off there.
 */
const allowPrivate = () => process.env.PROJECT_AGENT_ALLOW_PRIVATE === "1" && process.env.NODE_ENV !== "production";

/**
 * A URL Sentinel is willing to call: https, no embedded credentials, and not
 * an address literal inside a private range. Names are checked when they are
 * resolved, on the connection itself.
 */
export function parseOutsideUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new OutsideAgentError("That is not a valid URL.", "url_invalid", 400); }
  if (url.username || url.password) throw new OutsideAgentError("The URL must not contain a username or password.", "url_invalid", 400);
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) {
    throw new OutsideAgentError("The URL must start with https://.", "url_invalid", 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && (host === "localhost" || host.endsWith(".localhost") || (isIP(host) !== 0 && !isPublicAddress(host)))) {
    throw new OutsideAgentError("The URL points at a private or local address. An outside agent must be reachable on the public internet.", "url_not_public", 400);
  }
  url.hash = "";
  return url;
}

export interface OutsideRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  maxBytes: number;
}

export type OutsideTransport = (input: OutsideRequest) => Promise<unknown>;

/** Sends one request and returns the parsed JSON body. Throws OutsideAgentError for everything else. */
export const requestOutsideJson: OutsideTransport = async (input) => {
  const url = parseOutsideUrl(input.url);
  const payload = input.body === undefined ? null : Buffer.from(JSON.stringify(input.body));
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;

  // An absolute limit, not an idle one: a server that keeps sending a byte now
  // and then must not be able to hold the connection open past the deadline.
  let deadline: NodeJS.Timeout | undefined;
  const request = new Promise<unknown>((resolve, reject) => {
    const req = send(url, {
      method: input.method,
      headers: {
        accept: "application/json",
        "user-agent": "Sentinel-A2A/1",
        ...(payload ? { "content-type": "application/json", "content-length": String(payload.byteLength) } : {}),
        ...input.headers,
      },
      ...(allowPrivate() ? {} : { lookup: publicOnlyLookup }),
      // No connection reuse: every call re-resolves and is re-checked.
      agent: false,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(new OutsideAgentError("The agent's server answered with a redirect, which Sentinel does not follow. Use the final address.", "bad_status"));
      }
      if (status === 401 || status === 403) {
        res.resume();
        return reject(new OutsideAgentError("The agent's server refused Sentinel's token.", "unauthorized"));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new OutsideAgentError(`The agent's server answered ${status}.`, "bad_status"));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > input.maxBytes) {
          // Rejected here, not through the socket error: a body that arrived
          // in one read reaches "end" before the destroy does.
          reject(new OutsideAgentError("The agent's answer was larger than Sentinel accepts.", "too_large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", (error) => reject(asOutsideError(error)));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new OutsideAgentError("The agent's server did not answer with JSON.", "bad_response")); }
      });
    });
    deadline = setTimeout(() => {
      reject(new OutsideAgentError("The agent's server took too long to answer.", "timed_out", 504));
      req.destroy();
    }, input.timeoutMs);
    req.on("error", (error) => reject(asOutsideError(error)));
    req.end(payload ?? undefined);
  });
  return request.finally(() => clearTimeout(deadline));
};

function asOutsideError(error: unknown): OutsideAgentError {
  if (error instanceof OutsideAgentError) return error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EPRIVATEADDRESS") {
    return new OutsideAgentError("The agent's address resolves to a private or local network. An outside agent must be reachable on the public internet.", "url_not_public", 400);
  }
  return new OutsideAgentError("The agent's server could not be reached.", "unreachable");
}
