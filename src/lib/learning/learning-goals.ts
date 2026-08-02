import { db } from "@/lib/db";
import { type AccessibleLearningScope, buildLearningScopeWhere } from "./authorization";

// Only material gaps get a goal — creating a goal for every low-priority
// gap would flood the queue and defeat the point of prioritizing at all.
const MATERIAL_GAP_THRESHOLD = 0.5;

export interface GenerateLearningGoalsParams {
  minPriority?: number;
  limit?: number;
  scope?: AccessibleLearningScope;
}

export async function generateLearningGoalsFromGaps(params: GenerateLearningGoalsParams = {}) {
  const minPriority = params.minPriority ?? MATERIAL_GAP_THRESHOLD;
  const gaps = await db.knowledgeGap.findMany({
    where: {
      priorityScore: { gte: minPriority },
      status: { notIn: ["resolved", "dismissed"] },
      // Without a scope (internal/worker callers), this legitimately runs
      // system-wide. HTTP callers must always pass one — an unscoped read
      // here would return other tenants' gap titles/objectives directly in
      // the response, not just create globally-visible rows.
      ...(params.scope ? buildLearningScopeWhere(params.scope, { workspaceId: true, agentId: true }) : {}),
    },
    orderBy: { priorityScore: "desc" },
    take: params.limit ?? 20,
  });

  const created = [];
  for (const gap of gaps) {
    const existing = await db.learningGoal.findFirst({
      where: { knowledgeGapId: gap.id, status: { notIn: ["completed", "dismissed"] } },
    });
    if (existing) continue;

    const goal = await db.learningGoal.create({
      data: {
        knowledgeGapId: gap.id,
        agentId: gap.agentId,
        workspaceId: gap.workspaceId,
        title: `Close knowledge gap: ${gap.topic}`,
        objective: gap.description,
        successCriteria: [
          "The repeated low-confidence/failure signal for this topic stops recurring",
          "A learning candidate or documented answer exists for this topic",
        ],
        priority: gap.priorityScore >= 0.8 ? "high" : gap.priorityScore >= 0.6 ? "medium" : "low",
        status: "proposed",
      },
    });
    // "queued" — this gap now has a goal working it; distinct from the
    // detector's own "detected" default so re-running detection doesn't
    // treat it as brand new.
    await db.knowledgeGap.update({ where: { id: gap.id }, data: { status: "queued" } });
    created.push(goal);
  }
  return created;
}

export async function listLearningGoals(params?: {
  agentId?: string;
  status?: string;
  limit?: number;
  scope?: AccessibleLearningScope;
}) {
  return db.learningGoal.findMany({
    where: {
      ...(params?.agentId ? { agentId: params.agentId } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.scope ? buildLearningScopeWhere(params.scope, { workspaceId: true, agentId: true }) : {}),
    },
    include: { knowledgeGap: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(params?.limit ?? 50, 1), 200),
  });
}

export async function updateLearningGoal(
  id: string,
  data: { status?: string; approved?: boolean }
) {
  return db.learningGoal.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.approved !== undefined ? { approved: data.approved } : {}),
      ...(data.status === "completed" ? { completedAt: new Date() } : {}),
    },
  });
}
