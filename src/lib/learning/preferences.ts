import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const PREFERENCE_EVIDENCE_WEIGHTS = {
  explicit_user_statement: 1,
  explicit_correction: 0.9,
  explicit_approval: 0.8,
  repeated_observed_behavior: 0.5,
  single_implicit_behavior: 0.2,
  model_inference: 0.1,
} as const;

export type PreferenceEvidenceSourceType = keyof typeof PREFERENCE_EVIDENCE_WEIGHTS;

const GLOBAL_USER = "GLOBAL_USER";

export interface RecordPreferenceEvidenceInput {
  userId?: string | null;
  agentId?: string | null;
  workspaceId?: string | null;
  key: string;
  value: string;
  sourceType: PreferenceEvidenceSourceType;
  sourceId?: string | null;
  evidence: string;
  supportsPreference?: boolean;
  observedAt?: Date;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface ListPreferenceEvidenceParams {
  userId?: string | null;
  memoryId?: string;
  sourceType?: PreferenceEvidenceSourceType;
  conflictsOnly?: boolean;
  limit?: number;
}

export function normalizePreferenceKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Record auditable evidence for one canonical preference Memory.
 *
 * A disagreeing value is represented by `supportsPreference = false` and
 * conflict metadata on the evidence row. We deliberately keep the canonical
 * Memory content unchanged so a weak or isolated signal can never silently
 * replace an established preference.
 */
export async function recordPreferenceEvidence(input: RecordPreferenceEvidenceInput) {
  const key = normalizePreferenceKey(input.key);
  const value = input.value.trim();
  if (!key || !value || !input.evidence.trim()) {
    throw new Error("key, value, and evidence are required");
  }

  const evidenceWeight = PREFERENCE_EVIDENCE_WEIGHTS[input.sourceType];
  if (evidenceWeight === undefined) {
    throw new Error(`Unsupported preference evidence source type: ${input.sourceType}`);
  }

  const owner = input.userId ?? GLOBAL_USER;
  const memorySource = `learning-core:preference:${owner}:${key}`;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${memorySource})) IS NULL AS locked`;

    let memory = await tx.memory.findFirst({
      where: { type: "preference", owner, source: memorySource, archived: false },
      orderBy: { createdAt: "asc" },
    });

    if (!memory) {
      if (input.supportsPreference === false) {
        throw new Error("Cannot record conflicting evidence before a canonical preference exists");
      }
      memory = await tx.memory.create({
        data: {
          type: "preference",
          scope: input.workspaceId ? "workspace" : "user",
          owner,
          content: value,
          tags: ["preference", `preference-key:${key}`],
          confidence: 0,
          importanceScore: 0.5,
          source: memorySource,
        },
      });
    }

    const valueConflicts = normalizePreferenceValue(memory.content) !== normalizePreferenceValue(value);
    const conflict = input.supportsPreference === false || valueConflicts;
    const metadata = {
      ...(input.metadata ?? {}),
      preferenceKey: key,
      observedValue: value,
      ...(conflict
        ? {
            conflict: true,
            canonicalValue: memory.content,
            conflictReason: valueConflicts ? "different_value" : "explicitly_unsupported",
          }
        : {}),
    };

    const evidence = await tx.userPreferenceEvidence.create({
      data: {
        memoryId: memory.id,
        userId: input.userId ?? null,
        agentId: input.agentId ?? null,
        workspaceId: input.workspaceId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        evidence: input.evidence.trim(),
        evidenceWeight,
        supportsPreference: !conflict,
        observedAt: input.observedAt ?? new Date(),
        expiresAt: input.expiresAt ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    const activeEvidence = await tx.userPreferenceEvidence.findMany({
      where: {
        memoryId: memory.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { evidenceWeight: true, supportsPreference: true },
    });
    const confidence = calculatePreferenceConfidence(activeEvidence);
    memory = await tx.memory.update({
      where: { id: memory.id },
      data: { confidence },
    });

    return { evidence, memory, conflict };
  });
}

export function calculatePreferenceConfidence(
  evidence: Array<{ evidenceWeight: number; supportsPreference: boolean }>,
): number {
  let supportWeight = 0;
  let conflictWeight = 0;
  for (const item of evidence) {
    if (item.supportsPreference) supportWeight += item.evidenceWeight;
    else conflictWeight += item.evidenceWeight;
  }

  // The +1 is a neutral evidence reserve. It prevents a single implicit
  // observation (weight 0.2) from looking established while allowing repeated
  // strong evidence to asymptotically approach full confidence.
  const confidence = supportWeight / (supportWeight + conflictWeight + 1);
  return Math.round(Math.min(1, Math.max(0, confidence)) * 1000) / 1000;
}

export function listPreferenceEvidence(params: ListPreferenceEvidenceParams = {}) {
  return db.userPreferenceEvidence.findMany({
    where: {
      ...(params.userId !== undefined ? { userId: params.userId } : {}),
      ...(params.memoryId ? { memoryId: params.memoryId } : {}),
      ...(params.sourceType ? { sourceType: params.sourceType } : {}),
      ...(params.conflictsOnly ? { supportsPreference: false } : {}),
    },
    include: { memory: true },
    orderBy: { observedAt: "desc" },
    take: Math.min(Math.max(params.limit ?? 100, 1), 250),
  });
}

function normalizePreferenceValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
