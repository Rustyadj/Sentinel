import type { NextRequest } from "next/server";

/**
 * The externally reachable origin of this Sentinel deployment.
 *
 * `request.nextUrl.origin` cannot be used for this behind the reverse proxy.
 * Next 16 builds nextUrl from the server's own bind address, so it picks up
 * X-Forwarded-Proto but keeps the host as `0.0.0.0:3000` — it ignores both
 * Host and X-Forwarded-Host, and there is no config option to change that.
 * Every OAuth/MCP discovery document built from it therefore advertised
 * `https://0.0.0.0:3000`, which no external client can reach.
 *
 * AUTH_URL is preferred because it is the operator-set public origin already
 * trusted by NextAuth for exactly this reason. Deriving from forwarded headers
 * is only a development fallback: those headers are attacker-controllable, and
 * honouring them ahead of configuration would be host-header injection into
 * the very documents that tell a client where to send its credentials.
 */
export function publicOrigin(request: NextRequest): string {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured value — fall through rather than emit a broken origin.
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}
