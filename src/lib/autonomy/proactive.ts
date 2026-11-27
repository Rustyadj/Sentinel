/**
 * Proactive intelligence: decide which self-generated work is worth doing.
 * Pure — the scanner (proactive-scan.ts) supplies detected opportunities, this
 * scores them and applies anti-spam throttles; nothing here executes.
 *
 * Prioritization combines expected value, strategic relevance, urgency,
 * execution cost, resource availability, confidence, dependency readiness
 * and existing authority. Work without authority is never selected for
 * execution — it can only be surfaced as a request naming what is missing.
 */
import type { AutonomySettingsValues } from "./settings";

export type OpportunityKind =
  | "unfinished_task"        // a room task failed/blocked and nobody followed up
  | "stalled_objective"      // an objective has been waiting with no progress
  | "blocked_dependency"     // a step is blocked on something that may now be resolvable
  | "repeated_failure"       // the same failure keeps recurring -> workflow improvement
  | "stale_approval";        // a pending approval is holding work back

export interface Opportunity {
  /** Stable identity of the underlying problem, for deduplication across scans. */
  fingerprint: string;
  kind: OpportunityKind;
  workspaceId: string;
  agentId: string;
  title: string;
  detail: string;
  /** Where to act: a room (Lisa loop) or an objective. */
  target: { type: "room"; roomId: string; taskId?: string } | { type: "objective"; objectiveId: string; stepKey?: string };
  /** All factors 0..1. */
  expectedValue: number;
  strategicRelevance: number;
  urgency: number;
  /** Higher = more expensive. */
  executionCost: number;
  resourceAvailability: number;
  confidence: number;
  dependenciesReady: boolean;
  authorized: boolean;
}

const WEIGHTS = { expectedValue: 0.3, strategicRelevance: 0.2, urgency: 0.2, confidence: 0.15, resourceAvailability: 0.15 };
const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export function scoreOpportunity(op: Opportunity): number {
  if (!op.dependenciesReady) return 0;
  const benefit = WEIGHTS.expectedValue * clamp(op.expectedValue) + WEIGHTS.strategicRelevance * clamp(op.strategicRelevance)
    + WEIGHTS.urgency * clamp(op.urgency) + WEIGHTS.confidence * clamp(op.confidence) + WEIGHTS.resourceAvailability * clamp(op.resourceAvailability);
  const costed = benefit * (1 - 0.5 * clamp(op.executionCost));
  return Math.round(costed * 1000) / 1000;
}

export interface ProactiveHistory {
  /** Fingerprints acted on recently (dedupe: never re-run the same problem inside the interval). */
  recentFingerprints: ReadonlySet<string>;
  /** When this agent last started proactive work. */
  lastActivationAt: Date | null;
  /** Proactive starts by this agent in the last 24h. */
  startsLast24h: number;
}

export interface ProactiveSelection {
  execute: (Opportunity & { score: number })[];
  /** Valuable but missing authority: surfaced once, not executed. */
  needsAuthority: (Opportunity & { score: number })[];
  skipped: { fingerprint: string; reason: string }[];
}

type Settings = Pick<AutonomySettingsValues, "proactiveExecution" | "proactiveIntervalMinutes" | "proactiveDailyLimit" | "proactiveMinScore" | "maxConcurrentTasks">;

export function selectProactiveWork(opportunities: readonly Opportunity[], settings: Settings, history: ProactiveHistory, now = new Date()): ProactiveSelection {
  const result: ProactiveSelection = { execute: [], needsAuthority: [], skipped: [] };
  const seen = new Set<string>();
  const ranked = opportunities.map((op) => ({ ...op, score: scoreOpportunity(op) })).sort((a, b) => b.score - a.score || a.fingerprint.localeCompare(b.fingerprint));
  const sinceLast = history.lastActivationAt ? (now.getTime() - history.lastActivationAt.getTime()) / 60_000 : Infinity;
  let budget = !settings.proactiveExecution ? 0
    : sinceLast < settings.proactiveIntervalMinutes ? 0
    : Math.max(0, Math.min(settings.maxConcurrentTasks, settings.proactiveDailyLimit - history.startsLast24h));
  for (const op of ranked) {
    if (seen.has(op.fingerprint)) { result.skipped.push({ fingerprint: op.fingerprint, reason: "duplicate in this scan" }); continue; }
    seen.add(op.fingerprint);
    if (history.recentFingerprints.has(op.fingerprint)) { result.skipped.push({ fingerprint: op.fingerprint, reason: "already acted on recently" }); continue; }
    if (op.score < settings.proactiveMinScore) { result.skipped.push({ fingerprint: op.fingerprint, reason: `score ${op.score} below ${settings.proactiveMinScore}` }); continue; }
    if (!op.authorized) { result.needsAuthority.push(op); continue; }
    if (budget <= 0) {
      result.skipped.push({ fingerprint: op.fingerprint, reason: !settings.proactiveExecution ? "proactive execution disabled" : "activation throttle (interval/daily limit)" });
      continue;
    }
    result.execute.push(op);
    budget -= 1;
  }
  return result;
}
