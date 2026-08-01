import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Read-only aggregate across both Learning Core halves. Deliberately just
// counts/rates over what's actually persisted — no invented "quality
// scores" for things we don't measure yet (see docs/LEARNING_CORE_PLAN.md
// "Not yet specified").
export async function GET() {
  const [
    curiosityTotal,
    curiosityUnresolved,
    knowledgeGapsByPriority,
    reflectionTotal,
    reflectionAskMore,
    replayByCategory,
    preferenceTotal,
    hypothesisByStatus,
    experimentByStatus,
    skillTotal,
    trustEventTotal,
  ] = await Promise.all([
    db.curiosityEvent.count(),
    db.curiosityEvent.count({ where: { resolved: false } }),
    db.knowledgeGap.groupBy({ by: ["priority"], _count: true }),
    db.reflection.count(),
    db.reflection.count({ where: { shouldAskMore: true } }),
    db.replayEntry.groupBy({ by: ["category"], _count: true }),
    db.preference.count(),
    db.hypothesis.groupBy({ by: ["status"], _count: true }).catch(() => []),
    db.experiment.groupBy({ by: ["status"], _count: true }).catch(() => []),
    db.skill.count().catch(() => 0),
    db.trustEvent.count().catch(() => 0),
  ]);

  return NextResponse.json({
    curiosity: { total: curiosityTotal, unresolved: curiosityUnresolved },
    knowledgeGaps: Object.fromEntries(knowledgeGapsByPriority.map((g) => [g.priority, g._count])),
    reflection: { total: reflectionTotal, shouldAskMore: reflectionAskMore },
    replay: Object.fromEntries(replayByCategory.map((r) => [r.category, r._count])),
    preferences: { total: preferenceTotal },
    hypotheses: Object.fromEntries(hypothesisByStatus.map((h) => [h.status, h._count])),
    experiments: Object.fromEntries(experimentByStatus.map((e) => [e.status, e._count])),
    skills: { total: skillTotal },
    trustEvents: { total: trustEventTotal },
  });
}
