import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getQueueStatus } from "@/lib/learning/queue";

// ScheduledJobRun has no tenant-ownership column and legitimately can't:
// it records executions of system-wide scheduled jobs (degradation sweep,
// knowledge-gap analysis, experience replay) that span every tenant by
// design. Its `result`/`error` fields can reference candidate/agent/
// workspace identifiers from any tenant. This repository has no
// system/organization-admin authorization model (see
// docs/reviews/PR21_POST_MERGE_RECONCILIATION.md and
// src/lib/learning/authorization.ts's requireFeatureFlagAccess default
// case for the same gap) — so per the fail-closed rule, recent run detail
// is not exposed to any authenticated user here, only aggregate queue
// depth (which is not tenant-attributable data).
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const queueStatus = await getQueueStatus();

  return NextResponse.json({
    queue: queueStatus,
    recentRuns: [],
    recentRunsUnavailable: "no-admin-authorization-model",
  });
}
