import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { hashOpaqueSecret, randomOpaqueSecret, MCP_SCOPES } from "@/lib/integrations/oauth";
import { publicOrigin } from "@/lib/integrations/public-origin";
import { runMcpDiagnostics } from "@/lib/integrations/mcp-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAGNOSTIC_CLIENT_ID = "sentinel-diagnostics";
/** Long enough for one probe run, short enough that a leaked log is worthless. */
const TOKEN_TTL_MS = 120_000;

/**
 * Run the ChatGPT connector chain against this deployment's public origin.
 *
 * The probe needs a real bearer token, so one is minted here for the signed-in
 * user, scoped read-only, given a two-minute life, and revoked in a finally
 * block. It is never returned to the browser: the diagnostics run server-side
 * and only the sanitized report crosses back.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const origin = publicOrigin(request);
  const resource = `${origin}/api/mcp`;
  const scopes = MCP_SCOPES.filter((scope) => scope.endsWith(".read") || scope === "sentinel.read");

  const client = await db.externalClient.upsert({
    where: { clientId: DIAGNOSTIC_CLIENT_ID },
    update: { enabled: true, allowedScopes: scopes },
    create: {
      clientId: DIAGNOSTIC_CLIENT_ID,
      name: "Sentinel MCP diagnostics",
      redirectUris: [],
      allowedScopes: scopes,
      grantTypes: [],
      createdByUserId: user.id,
    },
  });

  const accessToken = randomOpaqueSecret(48);
  const minted = await db.oAuthAccessToken.create({
    data: {
      tokenHash: hashOpaqueSecret(accessToken),
      externalClientId: client.id,
      userId: user.id,
      scopes,
      resource,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
    select: { id: true },
  });

  try {
    const report = await runMcpDiagnostics({ origin, accessToken });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Diagnostics failed to run." }, { status: 500 });
  } finally {
    await db.oAuthAccessToken.update({ where: { id: minted.id }, data: { revokedAt: new Date() } }).catch(() => undefined);
  }
}
