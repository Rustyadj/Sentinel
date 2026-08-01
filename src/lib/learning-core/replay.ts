import { db } from "@/lib/db";

// The full spec calls for a nightly scheduled replay; there's no background
// job scheduler in this codebase yet (see docs/LEARNING_CORE_PLAN.md "Not
// yet specified"), so this runs on demand instead — via the API route or a
// future cron once one exists. runReplay() aggregates signal that already
// exists across both Learning Core halves into ReplayEntry rows; nothing
// here invents new failure/success data.
export async function runReplay(params?: { since?: Date }): Promise<{ created: number }> {
  const since = params?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  let created = 0;

  const unresolvedCuriosity = await db.curiosityEvent.findMany({
    where: { createdAt: { gte: since }, resolved: false, score: { gte: 0.6 } },
    orderBy: { score: "desc" },
    take: 10,
  });
  for (const event of unresolvedCuriosity) {
    await recordReplayEntry({
      category: "unresolved_curiosity",
      sourceRef: event.id,
      summary: `Unresolved high-curiosity question (score ${event.score.toFixed(2)}): ${event.question ?? event.triggerContext ?? "no detail"}`,
      lessons: ["This question never got answered — check if it's still relevant."],
      improvementOpportunities: ["Resolve or re-ask before it goes stale."],
    });
    created++;
  }

  const negativeReflections = await db.reflection.findMany({
    where: { createdAt: { gte: since }, wentWrong: { not: null } },
    take: 10,
  });
  for (const reflection of negativeReflections) {
    await recordReplayEntry({
      category: "failure",
      sourceRef: reflection.id,
      summary: reflection.wentWrong ?? "Reflection flagged a failure",
      lessons: reflection.shouldRemember ? [reflection.shouldRemember] : [],
      improvementOpportunities: reflection.skillIdea ? [reflection.skillIdea] : [],
    });
    created++;
  }

  // Cross-reads Codex's TrustEvent table for the categories the spec calls
  // "largest failures" material — rollbacks and unsafe events already
  // happened, this just makes sure they're not lost from the replay lens.
  const severeTrustEvents = await db.trustEvent.findMany({
    where: { createdAt: { gte: since }, category: { in: ["rollback", "unsafe_event", "hallucination"] } },
    take: 10,
  });
  for (const event of severeTrustEvents) {
    await recordReplayEntry({
      category: event.category === "rollback" ? "expensive" : event.category,
      sourceRef: event.id,
      summary: `${event.category.replaceAll("_", " ")} (${event.delta}): ${event.reason}`,
      lessons: [],
      improvementOpportunities: [`Review whether this recurs — repeated ${event.category} events should become a Hypothesis.`],
    });
    created++;
  }

  return { created };
}

export async function recordReplayEntry(input: {
  category: string;
  sourceRef?: string;
  summary: string;
  lessons?: string[];
  improvementOpportunities?: string[];
}) {
  return db.replayEntry.create({
    data: {
      category: input.category,
      sourceRef: input.sourceRef ?? null,
      summary: input.summary,
      lessons: input.lessons ?? [],
      improvementOpportunities: input.improvementOpportunities ?? [],
    },
  });
}

export async function listReplayEntries(params?: { category?: string; limit?: number }) {
  return db.replayEntry.findMany({
    where: params?.category ? { category: params.category } : {},
    orderBy: { runDate: "desc" },
    take: params?.limit ?? 50,
  });
}
