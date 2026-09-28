import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { canEditConfig, getControlPlaneUser } from "@/lib/agents/permissions";
import { resolveAgentMode, resolveSystemOneConfig } from "@/lib/system-one/config";
import { getSystemOne } from "@/lib/system-one/service";
import { getSystemOneSummary } from "@/lib/system-one/telemetry";

export const dynamic = "force-dynamic";

/**
 * System 1 cost/latency/routing summary. Control-plane owners and admins see
 * every user's decisions; anyone else sees only their own. Aggregates only —
 * no request text leaves this endpoint.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
  const windowDays = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  const controlPlane = await getControlPlaneUser(agentId);
  const global = Boolean(controlPlane && canEditConfig(controlPlane.role));

  const config = resolveSystemOneConfig();
  const summary = await getSystemOneSummary({ windowDays, agentId, userId: global ? undefined : user.id });
  return NextResponse.json({
    scope: global ? "all_users" : "own",
    config: {
      mode: config.mode,
      agentModes: {
        "hermes-lisa": resolveAgentMode("hermes-lisa"),
        "hermes-nathan2": resolveAgentMode("hermes-nathan2"),
      },
      provider: config.provider,
      model: config.model,
      keyConfigured: Boolean(config.apiKey),
      timeoutMs: config.timeoutMs,
      voiceTimeoutMs: config.voiceTimeoutMs,
      thresholds: config.thresholds,
      fastPathSurfaces: [...config.fastPathSurfaces],
      breaker: getSystemOne().service.breakerState(),
    },
    summary,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
