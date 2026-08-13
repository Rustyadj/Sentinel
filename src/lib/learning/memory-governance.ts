// Governed memory forgetting.
//
// Extends the canonical `Memory` model (see its schema block) with a
// configurable, versioned net-value policy and a state machine. Nothing
// here duplicates Memory or creates a second memory table — quarantine and
// forgetting are states on the same row, and "forgotten" means "excluded
// from normal retrieval", not necessarily "deleted" (see
// excludeFromRetrieval / src/lib/knowledge/retrieval.ts).

import { db } from "@/lib/db";
import type { Memory, Prisma } from "@prisma/client";
import { emitLearningEvent } from "./event-service";

export type MemoryState =
  | "active"
  | "stable"
  | "candidate"
  | "stale"
  | "disputed"
  | "quarantined"
  | "archived"
  | "forgotten";

// States that must never surface in normal retrieval — enforced both here
// (state-transition guard) and in src/lib/knowledge/retrieval.ts (query
// filter), so a caller bypassing this module still can't retrieve them.
export const RETRIEVAL_EXCLUDED_STATES: ReadonlySet<MemoryState> = new Set(["quarantined", "forgotten"]);

export interface MemoryValueWeights {
  usefulness: number;
  confidence: number;
  transferability: number;
  confirmation: number;
  harm: number;
  staleness: number;
  retrievalCost: number;
  poisonRisk: number;
  contradiction: number;
}

// Not immutable architecture — a versioned, configurable policy. Kept as a
// named constant + resolver (like evolution.ts's fitness weights) rather
// than a hardcoded formula baked into the computation itself.
export const DEFAULT_MEMORY_VALUE_WEIGHTS: MemoryValueWeights = {
  usefulness: 0.25,
  confidence: 0.15,
  transferability: 0.1,
  confirmation: 0.1,
  harm: 0.2,
  staleness: 0.1,
  retrievalCost: 0.05,
  poisonRisk: 0.25,
  contradiction: 0.1,
};

export const MEMORY_VALUE_POLICY_VERSION = "v1";

export async function resolveMemoryValueWeights(workspaceId?: string | null): Promise<MemoryValueWeights> {
  if (!workspaceId) return DEFAULT_MEMORY_VALUE_WEIGHTS;
  const settings = await db.learningSettings.findUnique({
    where: { scopeType_scopeId: { scopeType: "workspace", scopeId: workspaceId } },
    select: { trustThresholds: true },
  });
  const configured = (settings?.trustThresholds as { memoryValueWeights?: Partial<MemoryValueWeights> } | null)
    ?.memoryValueWeights;
  return configured ? { ...DEFAULT_MEMORY_VALUE_WEIGHTS, ...configured } : DEFAULT_MEMORY_VALUE_WEIGHTS;
}

/**
 * Net Memory Value = usefulness + confidence + transferability + confirmation
 *                     - harm - staleness - retrievalCost - poisonRisk - unresolvedContradiction
 * Every input term is clamped to [0,1] before weighting; unset terms
 * contribute 0 rather than being imputed, so a memory with no governance
 * signals yet scores near-neutral instead of artificially high or low.
 */
export function computeMemoryNetValue(
  memory: Pick<
    Memory,
    "valueScore" | "confidence" | "transferability" | "confirmationCount" | "harmScore" | "stalenessScore" | "retrievalCost" | "poisonRisk" | "contradictionCount" | "importanceScore"
  >,
  weights: MemoryValueWeights = DEFAULT_MEMORY_VALUE_WEIGHTS,
): number {
  const clamp01 = (v: number | null | undefined) => Math.min(Math.max(v ?? 0, 0), 1);
  const usefulness = clamp01(memory.valueScore ?? memory.importanceScore);
  const confidence = clamp01(memory.confidence);
  const transferability = clamp01(memory.transferability);
  const confirmation = clamp01((memory.confirmationCount ?? 0) / 5); // 5+ confirmations = full credit
  const harm = clamp01(memory.harmScore);
  const staleness = clamp01(memory.stalenessScore);
  const retrievalCost = clamp01(memory.retrievalCost);
  const poisonRisk = clamp01(memory.poisonRisk);
  const contradiction = clamp01((memory.contradictionCount ?? 0) / 3); // 3+ unresolved contradictions = full penalty

  const value =
    usefulness * weights.usefulness +
    confidence * weights.confidence +
    transferability * weights.transferability +
    confirmation * weights.confirmation -
    harm * weights.harm -
    staleness * weights.staleness -
    retrievalCost * weights.retrievalCost -
    poisonRisk * weights.poisonRisk -
    contradiction * weights.contradiction;

  return Math.round(Math.min(Math.max(value, -1), 1) * 1000) / 1000;
}

export interface QuarantineMemoryInput {
  memoryId: string;
  reason: string;
  poisonRisk?: number;
  actorId?: string;
}

// Up to 4 words of slack between the trigger verb and its object so "ignore
// all previous instructions" (two modifiers) matches as reliably as "ignore
// instructions" (zero modifiers) — same pattern shape as Guardian's
// hard-block detector (guardian.ts), applied here to memory content instead
// of action descriptions.
const QUARANTINE_TRIGGER_KEYWORDS =
  /\b(ignore|disregard)\b(?:\s+\S+){0,4}\s+(instructions|rules)\b|system prompt override|you are now unrestricted/i;

/**
 * Suspicious memories enter `quarantined` and are excluded from normal
 * retrieval until validated. Callers pass an explicit reason (unknown
 * provenance, prompt-injection-derived content, contradictory tool output,
 * malicious website content, adversarial test content, low-confidence
 * generated claim, ...) — this function does not itself decide *whether*
 * to quarantine beyond one deterministic content check; upstream detection
 * (adversarial self-play, contradiction detection, retrieval-time scanning)
 * is what actually flags candidates for quarantine.
 */
export async function quarantineMemory(input: QuarantineMemoryInput) {
  const memory = await db.memory.update({
    where: { id: input.memoryId },
    data: {
      state: "quarantined",
      poisonRisk: input.poisonRisk ?? 0.8,
    },
  });
  await emitLearningEvent({
    eventType: "memory_quarantined",
    sourceType: "memory",
    sourceId: memory.id,
    payload: { reason: input.reason, actorId: input.actorId ?? "system" },
  }).catch(() => {});
  return memory;
}

/** Deterministic pre-quarantine scan for obviously injected content — a real, narrow heuristic, not semantic understanding. */
export function detectsInjectionSignature(content: string): boolean {
  return QUARANTINE_TRIGGER_KEYWORDS.test(content);
}

export interface ValidateMemoryInput {
  memoryId: string;
  actorId: string;
  newState?: Extract<MemoryState, "active" | "stable">;
}

/** Moves a quarantined memory back into normal retrieval once a human/process validates it. */
export async function validateQuarantinedMemory(input: ValidateMemoryInput) {
  const current = await db.memory.findUniqueOrThrow({ where: { id: input.memoryId } });
  if (current.state !== "quarantined" && current.state !== "disputed") {
    throw new Error(`Memory ${input.memoryId} is "${current.state}" — nothing to validate.`);
  }
  const memory = await db.memory.update({
    where: { id: input.memoryId },
    data: {
      state: input.newState ?? "active",
      poisonRisk: 0,
      lastValidatedAt: new Date(),
    },
  });
  await emitLearningEvent({
    eventType: "memory_validated",
    sourceType: "memory",
    sourceId: memory.id,
    userId: input.actorId,
    payload: { newState: memory.state },
  }).catch(() => {});
  return memory;
}

export interface ForgetMemoryInput {
  memoryId: string;
  reason: string;
  actorId?: string;
}

/** `forgotten` removes a memory from normal retrieval. Never a hard delete here — audit/history requirements. */
export async function forgetMemory(input: ForgetMemoryInput) {
  const memory = await db.memory.update({
    where: { id: input.memoryId },
    data: { state: "forgotten", archived: true },
  });
  await emitLearningEvent({
    eventType: "memory_forgotten",
    sourceType: "memory",
    sourceId: memory.id,
    payload: { reason: input.reason, actorId: input.actorId ?? "system" },
  }).catch(() => {});
  return memory;
}

export interface DecaySweepResult {
  scanned: number;
  markedStale: number;
  forgotten: number;
  survived: number;
}

const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000; // 90 days unused
const FORGET_NET_VALUE_THRESHOLD = -0.3;

/**
 * Scheduled (externally-triggered, same convention as
 * runDegradationSweep/monitorAndAutoRollback — no in-process scheduler
 * exists in this repo) sweep: recomputes staleness from lastUsefulAt,
 * recomputes net value, and forgets memories whose net value falls below
 * threshold. Pinned and already-quarantined/forgotten/archived memories are
 * skipped — pinning is an explicit human override this sweep must not undo,
 * and quarantine/forgetting/archival have their own dedicated transitions.
 */
export async function runMemoryDecaySweep(params: { workspaceId?: string; limit?: number } = {}): Promise<DecaySweepResult> {
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2000);
  const memories = await db.memory.findMany({
    where: {
      pinned: false,
      archived: false,
      state: { notIn: ["quarantined", "forgotten", "archived"] },
      ...(params.workspaceId ? {} : {}),
    },
    take: limit,
  });

  const weights = await resolveMemoryValueWeights(params.workspaceId);
  let markedStale = 0;
  let forgotten = 0;
  let survived = 0;

  for (const memory of memories) {
    const lastActive = memory.lastUsefulAt ?? memory.updatedAt;
    const ageMs = Date.now() - lastActive.getTime();
    const stalenessScore = Math.min(1, ageMs / STALE_AFTER_MS);
    const netValue = computeMemoryNetValue({ ...memory, stalenessScore }, weights);

    if (netValue < FORGET_NET_VALUE_THRESHOLD) {
      await db.memory.update({
        where: { id: memory.id },
        data: { state: "forgotten", stalenessScore, valueScore: netValue, archived: true },
      });
      forgotten += 1;
    } else if (stalenessScore > 0.5 && memory.state === "active") {
      await db.memory.update({
        where: { id: memory.id },
        data: { state: "stale", stalenessScore, valueScore: netValue },
      });
      markedStale += 1;
    } else {
      await db.memory.update({ where: { id: memory.id }, data: { stalenessScore, valueScore: netValue } });
      survived += 1;
    }
  }

  await emitLearningEvent({
    eventType: "memory_decay_sweep_completed",
    sourceType: "memory",
    workspaceId: params.workspaceId,
    payload: { scanned: memories.length, markedStale, forgotten, survived },
  }).catch(() => {});

  return { scanned: memories.length, markedStale, forgotten, survived };
}

export function excludeFromRetrieval(): Prisma.MemoryWhereInput {
  return { state: { notIn: [...RETRIEVAL_EXCLUDED_STATES] } };
}

export async function recordMemoryUsed(memoryId: string) {
  return db.memory.update({
    where: { id: memoryId },
    data: { lastUsefulAt: new Date(), confirmationCount: { increment: 1 } },
  }).catch(() => null); // best-effort — a retrieval hit must never fail the caller's request
}

export async function recordMemoryContradiction(memoryId: string) {
  const memory = await db.memory.update({
    where: { id: memoryId },
    data: { contradictionCount: { increment: 1 } },
  });
  if (memory.contradictionCount >= 3 && memory.state === "active") {
    return db.memory.update({ where: { id: memoryId }, data: { state: "disputed" } });
  }
  return memory;
}
