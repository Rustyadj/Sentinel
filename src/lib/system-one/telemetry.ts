/**
 * System 1 telemetry: a per-request phase trace, one persisted row per
 * decision, and the aggregate that answers "how much did System 1 save?".
 *
 * Writes are fire-and-forget and self-guarded — telemetry never costs a user
 * their answer or a millisecond on the response path.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calculateModelCost } from "@/lib/agents/pricing";
import { logger } from "@/lib/logger";
import type { RoutingPlan, SystemOneMode, SystemOneResult, SystemOneSurface } from "./types";

export type PhaseMark =
  | "request_received"
  | "s1_start" | "s1_complete"
  | "routing_complete"
  | "memory_start" | "memory_complete"
  | "tool_start" | "tool_complete"
  | "system2_start" | "system2_first_token" | "system2_complete"
  | "response_first_token"
  | "request_complete";

/** Millisecond offsets from request receipt. First mark of each name wins. */
export class RequestTrace {
  private readonly startedAt = performance.now();
  readonly phases: Partial<Record<PhaseMark, number>> = { request_received: 0 };

  mark(name: PhaseMark): void {
    if (this.phases[name] === undefined) this.phases[name] = Math.round(performance.now() - this.startedAt);
  }

  elapsed(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}

export type ExecutedPath = "system2" | "system2_skip_memory" | "fast_path_tool" | "fast_path_failed";

export interface DecisionRecord {
  /** Pre-assigned so a caller can hand it to the client before the write lands. */
  id?: string;
  surface: SystemOneSurface;
  agentId: string;
  userId: string;
  roomId?: string | null;
  mode: SystemOneMode;
  result: SystemOneResult;
  plan: RoutingPlan | null;
  executedPath: ExecutedPath;
  system2Invoked: boolean;
  memorySkipped?: boolean;
  tool?: { id: string; ok: boolean; latencyMs: number } | null;
  system2?: { model: string | null; inputTokens: number; outputTokens: number; tools: string[] } | null;
  trace: RequestTrace;
  interrupted?: boolean;
}

const json = (v: unknown) => (v ?? undefined) as Prisma.InputJsonValue | undefined;

/**
 * Estimate what a System 2 turn would have cost, from this agent's own recent
 * System 2 turns on the same surface. No history → null, not a guess.
 */
async function estimateAvoided(agentId: string, surface: string): Promise<{ tokens: number | null; costUsd: number | null }> {
  const recent = await db.systemOneDecision.findMany({
    where: { agentId, surface, system2Invoked: true, system2InputTokens: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { system2InputTokens: true, system2OutputTokens: true, system2Model: true },
  });
  if (recent.length === 0) return { tokens: null, costUsd: null };
  const avgIn = recent.reduce((s, r) => s + (r.system2InputTokens ?? 0), 0) / recent.length;
  const avgOut = recent.reduce((s, r) => s + (r.system2OutputTokens ?? 0), 0) / recent.length;
  const model = recent[0].system2Model;
  const cost = model
    ? calculateModelCost(model, { inputTokens: avgIn, outputTokens: avgOut, cachedInputTokens: 0, cacheWrite5mInputTokens: 0, cacheWrite1hInputTokens: 0 })
    : null;
  return { tokens: Math.round(avgIn + avgOut), costUsd: cost };
}

/** Persists one decision row. Returns its id (for late updates such as TTFA), or null. */
export async function recordDecision(record: DecisionRecord): Promise<string | null> {
  // Off-mode rows are the measured "current Sentinel" baseline the shadow and
  // active numbers are compared against. They can be switched off.
  if (record.mode === "off" && process.env.SYSTEM_ONE_BASELINE_TELEMETRY?.trim().toLowerCase() === "false") return null;
  try {
    const avoided = record.executedPath === "fast_path_tool" && !record.system2Invoked
      ? await estimateAvoided(record.agentId, record.surface)
      : { tokens: null, costUsd: null };
    const d = record.result.decision;
    const row = await db.systemOneDecision.create({
      data: {
        ...(record.id ? { id: record.id } : {}),
        surface: record.surface,
        agentId: record.agentId,
        userId: record.userId,
        roomId: record.roomId ?? null,
        mode: record.mode,
        outcome: record.result.outcome,
        provider: record.result.provider,
        providerModel: record.result.providerModel,
        s1LatencyMs: record.result.latencyMs,
        s1InputTokens: record.result.inputTokens,
        s1CostUsd: record.result.costUsd,
        intent: d?.intent ?? null,
        route: d?.route ?? null,
        confidence: d?.confidence ?? null,
        decision: json(d),
        plannedAction: record.plan?.action ?? null,
        planReasons: json(record.plan?.reasons),
        executedPath: record.executedPath,
        system2Invoked: record.system2Invoked,
        system2Avoided: record.executedPath === "fast_path_tool" && !record.system2Invoked,
        memorySkipped: record.memorySkipped ?? false,
        toolId: record.tool?.id ?? null,
        toolOk: record.tool?.ok ?? null,
        toolLatencyMs: record.tool?.latencyMs ?? null,
        system2Model: record.system2?.model ?? null,
        system2InputTokens: record.system2?.inputTokens ?? null,
        system2OutputTokens: record.system2?.outputTokens ?? null,
        system2Tools: json(record.system2?.tools),
        estTokensAvoided: avoided.tokens,
        estCostAvoidedUsd: avoided.costUsd,
        totalLatencyMs: record.trace.phases.request_complete ?? record.trace.elapsed(),
        phases: record.trace.phases as Prisma.InputJsonValue,
        interrupted: record.interrupted ?? false,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    logger.warn("system_one.telemetry.write_failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Late-arriving client measurement (voice time-to-first-audio). Owner-checked. */
export async function recordTimeToFirstAudio(id: string, userId: string, ttfaMs: number): Promise<boolean> {
  if (!Number.isFinite(ttfaMs) || ttfaMs < 0 || ttfaMs > 120_000) return false;
  const updated = await db.systemOneDecision.updateMany({ where: { id, userId, ttfaMs: null }, data: { ttfaMs: Math.round(ttfaMs) } });
  return updated.count === 1;
}

export interface SystemOneSummary {
  windowDays: number;
  requests: number;
  byMode: Record<string, number>;
  byExecutedPath: Record<string, number>;
  handledWithoutSystem2: number;
  system2CallsAvoided: number;
  fallbackRate: number | null;
  s1: { p50: number | null; p95: number | null; costUsd: number; inputTokens: number };
  totalLatency: Record<string, { p50: number | null; p95: number | null; n: number }>;
  ttfa: Record<string, { p50: number | null; p95: number | null; n: number }>;
  estTokensAvoided: number;
  estCostAvoidedUsd: number | null;
  netSavingsUsd: number | null;
  confidenceHistogram: number[];
  shadowToolAgreement: { comparable: number; agreed: number; rate: number | null };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function latencyStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), n: sorted.length };
}

export async function getSystemOneSummary(options: { windowDays?: number; agentId?: string; userId?: string } = {}): Promise<SystemOneSummary> {
  const windowDays = options.windowDays ?? 7;
  const rows = await db.systemOneDecision.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - windowDays * 86_400_000) },
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
    },
    select: {
      mode: true, outcome: true, executedPath: true, system2Invoked: true, system2Avoided: true, s1LatencyMs: true,
      s1CostUsd: true, s1InputTokens: true, totalLatencyMs: true, ttfaMs: true, estTokensAvoided: true,
      estCostAvoidedUsd: true, confidence: true, plannedAction: true, toolId: true, decision: true, system2Tools: true,
    },
    take: 20_000,
    orderBy: { createdAt: "desc" },
  });

  const count = <K extends string>(key: (r: (typeof rows)[number]) => K) =>
    rows.reduce<Record<string, number>>((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {});

  const consulted = rows.filter((r) => r.mode !== "off");
  const fallbacks = consulted.filter((r) => r.outcome !== "ok").length;
  const s1Latencies = rows.map((r) => r.s1LatencyMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const s1Cost = rows.reduce((s, r) => s + (r.s1CostUsd ?? 0), 0);

  const byPath = (field: "totalLatencyMs" | "ttfaMs") => {
    const groups: Record<string, number[]> = {};
    for (const r of rows) {
      const v = r[field];
      if (v === null) continue;
      (groups[r.executedPath] ??= []).push(v);
    }
    return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, latencyStats(v)]));
  };

  const avoidedRows = rows.filter((r) => r.system2Avoided);
  const pricedAvoided = avoidedRows.filter((r) => r.estCostAvoidedUsd !== null);
  // Dollars are only reported when every avoided call could be priced;
  // a partial sum would understate savings while looking complete.
  const estCostAvoidedUsd = avoidedRows.length > 0 && pricedAvoided.length === avoidedRows.length
    ? pricedAvoided.reduce((s, r) => s + (r.estCostAvoidedUsd ?? 0), 0)
    : avoidedRows.length === 0 ? 0 : null;

  const histogram = new Array(10).fill(0) as number[];
  for (const r of rows) if (r.confidence !== null) histogram[Math.min(9, Math.floor(r.confidence * 10))] += 1;

  // Shadow ground truth: when System 1 would have fast-pathed a tool and
  // System 2 actually ran, did System 2 call that same tool?
  const comparable = rows.filter((r) => r.mode === "shadow" && r.plannedAction === "fast_path_tool" && Array.isArray(r.system2Tools));
  const agreed = comparable.filter((r) => {
    const suggested = (r.decision as { suggestedTool?: string } | null)?.suggestedTool;
    const name = suggested?.split(".").slice(1).join(".");
    return Boolean(name) && (r.system2Tools as string[]).includes(name!);
  }).length;

  return {
    windowDays,
    requests: rows.length,
    byMode: count((r) => r.mode),
    byExecutedPath: count((r) => r.executedPath),
    handledWithoutSystem2: rows.filter((r) => !r.system2Invoked).length,
    system2CallsAvoided: avoidedRows.length,
    fallbackRate: consulted.length ? fallbacks / consulted.length : null,
    s1: { p50: percentile(s1Latencies, 50), p95: percentile(s1Latencies, 95), costUsd: s1Cost, inputTokens: rows.reduce((s, r) => s + r.s1InputTokens, 0) },
    totalLatency: byPath("totalLatencyMs"),
    ttfa: byPath("ttfaMs"),
    estTokensAvoided: avoidedRows.reduce((s, r) => s + (r.estTokensAvoided ?? 0), 0),
    estCostAvoidedUsd,
    netSavingsUsd: estCostAvoidedUsd === null ? null : estCostAvoidedUsd - s1Cost,
    confidenceHistogram: histogram,
    shadowToolAgreement: { comparable: comparable.length, agreed, rate: comparable.length ? agreed / comparable.length : null },
  };
}
