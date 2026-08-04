import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  runCoOccurrenceSelfImprovement,
  listSelfImprovementCandidates,
} from "@/lib/learning/self-improvement";
import { getAccessibleLearningScope } from "@/lib/learning/authorization";

// Real read over what the co-occurrence self-improvement engine has actually
// proposed/applied — same LearningCandidate table every other Learning Core
// surface reads, filtered to this engine's generationPipeline marker.
export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = await getAccessibleLearningScope(user.id);
  const candidates = await listSelfImprovementCandidates({
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    scope,
  });
  return NextResponse.json({ candidates });
}

// Manual trigger — the real recurring job runs weekly via the learning
// worker (see queue.ts's coOccurrenceDiscovery scheduler); this lets a
// caller run detection on demand, scoped to a workspace they can access.
export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
  const scope = await getAccessibleLearningScope(user.id);

  if (requestedWorkspaceId && !scope.workspaceIds.includes(requestedWorkspaceId)) {
    return NextResponse.json({ error: "Learning resource not found" }, { status: 404 });
  }
  if (!requestedWorkspaceId && scope.workspaceIds.length === 0) {
    return NextResponse.json({ opportunitiesDetected: 0, proposed: 0, autoApplied: 0, skipped: 0 });
  }

  const result = requestedWorkspaceId
    ? await runCoOccurrenceSelfImprovement({
        workspaceId: requestedWorkspaceId,
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      })
    : await (async () => {
        const runs = await Promise.all(
          scope.workspaceIds.map((workspaceId) => runCoOccurrenceSelfImprovement({ workspaceId })),
        );
        return runs.reduce(
          (total, run) => ({
            opportunitiesDetected: total.opportunitiesDetected + run.opportunitiesDetected,
            proposed: total.proposed + run.proposed,
            autoApplied: total.autoApplied + run.autoApplied,
            skipped: total.skipped + run.skipped,
          }),
          { opportunitiesDetected: 0, proposed: 0, autoApplied: 0, skipped: 0 },
        );
      })();

  return NextResponse.json(result);
}
