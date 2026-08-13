import { db } from "@/lib/db";
import { syncKnowledgeGapToGraph } from "./graph";

// A gap becomes worth an agent's attention once it's been hit repeatedly
// (not a one-off) or confidence in the topic is consistently low.
export function computeGapPriority(occurrenceCount: number, confidence: number): "low" | "medium" | "high" {
  if (occurrenceCount >= 10 || confidence <= 0.2) return "high";
  if (occurrenceCount >= 4 || confidence <= 0.4) return "medium";
  return "low";
}

// Call this every time an agent notices it repeated the same low-confidence
// topic — e.g. after answering a domain question it isn't sure about. Idempotent
// per (agentId, topic): repeated calls raise occurrenceCount and sharpen the
// confidence estimate rather than creating duplicate rows.
export async function recordKnowledgeGap(input: {
  agentId: string;
  topic: string;
  description: string;
  confidence: number;
  estimatedBenefit?: string;
}) {
  const existing = await db.knowledgeGap.findUnique({
    where: { agentId_topic: { agentId: input.agentId, topic: input.topic } },
  });

  const occurrenceCount = (existing?.occurrenceCount ?? 0) + 1;
  // Confidence trends toward the weaker (more uncertain) of the two readings —
  // repeated exposure should erode false confidence, not average it away.
  const confidence = existing ? Math.min(existing.confidence, input.confidence) : input.confidence;
  const priority = computeGapPriority(occurrenceCount, confidence);

  const gap = await db.knowledgeGap.upsert({
    where: { agentId_topic: { agentId: input.agentId, topic: input.topic } },
    create: {
      agentId: input.agentId,
      topic: input.topic,
      description: input.description,
      occurrenceCount: 1,
      confidence: input.confidence,
      priority,
      estimatedBenefit: input.estimatedBenefit ?? null,
    },
    update: {
      description: input.description,
      occurrenceCount,
      confidence,
      priority,
      ...(input.estimatedBenefit ? { estimatedBenefit: input.estimatedBenefit } : {}),
    },
  });
  await syncKnowledgeGapToGraph(gap);
  return gap;
}

export async function updateKnowledgeGapStatus(id: string, status: "open" | "learning" | "resolved") {
  const gap = await db.knowledgeGap.update({ where: { id }, data: { status } });
  await syncKnowledgeGapToGraph(gap);
  return gap;
}

const PRIORITY_WEIGHT: Record<string, number> = { high: 2, medium: 1, low: 0 };

export async function listKnowledgeGaps(params?: { agentId?: string; status?: string; limit?: number }) {
  const gaps = await db.knowledgeGap.findMany({
    where: {
      ...(params?.agentId ? { agentId: params.agentId } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
    include: { agent: { select: { id: true, name: true, avatar: true, color: true } } },
    orderBy: { occurrenceCount: "desc" },
    take: params?.limit ?? 50,
  });
  // priority is a small string enum, not lexicographically sortable in SQL
  // (alphabetically "medium" > "low" > "high") — reorder in memory instead.
  return gaps.sort((a, b) => (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0));
}
