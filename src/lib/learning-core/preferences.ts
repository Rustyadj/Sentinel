import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { syncToGraph } from "@/lib/knowledge/sync";

// Confidence climbs with repeated, consistent evidence and never exceeds 0.95
// (a preference is never "certain" — it can still be contradicted). A single
// observation starts modest; agreeing evidence compounds rather than resets.
const INITIAL_CONFIDENCE = 0.4;
const CONFIDENCE_STEP = 0.15;
const MAX_CONFIDENCE = 0.95;

// Postgres treats every NULL in a unique index as distinct from every other
// NULL, so a compound unique on a nullable userId can't be used for lookups
// (Prisma's generated where type reflects that — see the field's schema
// comment). A sentinel keeps "no specific user" queryable via the same index.
const GLOBAL_USER = "__global__";

export async function learnPreference(input: {
  userId?: string;
  key: string;
  value: unknown;
  sourceConversationId?: string;
  expiresAt?: Date;
}) {
  const userId = input.userId ?? GLOBAL_USER;
  const existing = await db.preference.findUnique({
    where: { userId_key: { userId, key: input.key } },
  });

  const sameValue = existing && JSON.stringify(existing.value) === JSON.stringify(input.value);
  const confidence = existing
    ? sameValue
      ? Math.min(existing.confidence + CONFIDENCE_STEP, MAX_CONFIDENCE)
      : INITIAL_CONFIDENCE // contradicted — reset rather than average, don't quietly split the difference
    : INITIAL_CONFIDENCE;

  const conflicts =
    existing && !sameValue
      ? [...(existing.conflicts as unknown[]), { previousValue: existing.value, replacedAt: new Date().toISOString() }]
      : (existing?.conflicts ?? []);

  const preference = await db.preference.upsert({
    where: { userId_key: { userId, key: input.key } },
    create: {
      userId,
      key: input.key,
      value: input.value as Prisma.InputJsonValue,
      confidence,
      sourceConversationIds: input.sourceConversationId ? [input.sourceConversationId] : [],
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
    update: {
      value: input.value as Prisma.InputJsonValue,
      confidence,
      lastConfirmedAt: new Date(),
      conflicts: conflicts as unknown as Prisma.InputJsonValue,
      ...(input.sourceConversationId
        ? { sourceConversationIds: { push: input.sourceConversationId } }
        : {}),
    },
  });

  await syncToGraph({
    sourceType: "preference",
    sourceId: preference.id,
    type: "Preference",
    title: input.key,
    summary: JSON.stringify(input.value),
    scope: userId === GLOBAL_USER ? "global" : "user",
    metadata: { confidence: preference.confidence },
  });

  return preference;
}

export async function listPreferences(params?: { userId?: string; minConfidence?: number }) {
  const preferences = await db.preference.findMany({
    where: {
      userId: params?.userId ?? GLOBAL_USER,
      ...(params?.minConfidence !== undefined ? { confidence: { gte: params.minConfidence } } : {}),
    },
    orderBy: { confidence: "desc" },
  });
  // Preferences past their expiry are still visible (audit trail) but callers
  // deciding behavior should treat them as unset — filtering here would hide
  // the fact that a preference existed at all.
  return preferences.map((p) => ({ ...p, expired: p.expiresAt ? p.expiresAt < new Date() : false }));
}
