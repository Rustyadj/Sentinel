import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { diffCompositions, findRedundantRestrictions, type ComposedLayerManifest } from "@/lib/autonomy/prompt-layers";
import { autonomyErrorResponse } from "../_shared";

/**
 * Prompt inspection: exactly what Sentinel contributed to an agent's context,
 * per surface, and a layer-by-layer comparison between two compositions.
 *
 *   ?workspaceId&agentId                 recent compositions
 *   ?workspaceId&compare=<idA>,<idB>     diff two compositions
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const workspaceId = params.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "agents.runtime.view");

    const compare = params.get("compare");
    if (compare) {
      const [a, b] = compare.split(",").map((value) => value.trim());
      if (!a || !b) return NextResponse.json({ error: "compare takes two ids" }, { status: 400 });
      const rows = await db.promptComposition.findMany({ where: { id: { in: [a, b] }, workspaceId } });
      const before = rows.find((row) => row.id === a);
      const after = rows.find((row) => row.id === b);
      if (!before || !after) return NextResponse.json({ error: "Composition not found in this workspace" }, { status: 404 });
      return NextResponse.json({
        before: { id: before.id, surface: before.surface, lastUsedAt: before.lastUsedAt },
        after: { id: after.id, surface: after.surface, lastUsedAt: after.lastUsedAt },
        diff: diffCompositions(before.layers as unknown as ComposedLayerManifest[], after.layers as unknown as ComposedLayerManifest[]),
        sentinelCharsDelta: after.sentinelChars - before.sentinelChars,
      });
    }

    const agentId = params.get("agentId");
    const compositions = await db.promptComposition.findMany({
      where: { workspaceId, ...(agentId ? { agentId } : {}) },
      orderBy: { lastUsedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      compositions: compositions.map((row) => ({
        id: row.id, agentId: row.agentId, surface: row.surface, layers: row.layers, sentinelText: row.sentinelText,
        totalChars: row.totalChars, sentinelChars: row.sentinelChars, useCount: row.useCount,
        firstUsedAt: row.firstUsedAt, lastUsedAt: row.lastUsedAt,
        // Sentinel's own layers must never carry redundant restrictions; surfaced so a regression is visible.
        sentinelRestrictionFindings: findRedundantRestrictions(row.sentinelText),
      })),
    });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}
