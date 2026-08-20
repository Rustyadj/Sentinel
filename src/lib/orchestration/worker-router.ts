import { db } from "@/lib/db";
import { getCapabilityWeights, type AgentCapabilityKey } from "./capabilities";
import { listActiveLocks } from "./execution-lock";

const ACTIVE_TASK_STATUSES = ["QUEUED", "CLAIMED", "RUNNING", "WAITING_REVIEW", "CHANGES_REQUESTED"];

export async function currentWorkload(chatRoomId: string, agentId: string): Promise<number> {
  return db.task.count({ where: { chatRoomId, agentId, status: { in: ACTIVE_TASK_STATUSES } } });
}

/** Strips the glob suffix so two patterns can be compared by their root path. */
function patternRoot(pattern: string): string {
  return pattern.replace(/[*].*$/, "");
}

function patternsOverlap(a: string, b: string): boolean {
  const rootA = patternRoot(a);
  const rootB = patternRoot(b);
  return rootA.startsWith(rootB) || rootB.startsWith(rootA);
}

async function hasFileConflict(chatRoomId: string, agentId: string, fileScope: string[]): Promise<boolean> {
  if (!fileScope.length) return false;
  const locks = await listActiveLocks(chatRoomId);
  return locks.some((lock) => lock.agentId !== agentId && fileScope.some((pattern) => patternsOverlap(lock.resourcePattern, pattern)));
}

export interface SelectWorkerInput {
  chatRoomId: string;
  requiredCapabilities: AgentCapabilityKey[];
  candidates: string[];
  fileScope?: string[];
  /** Agent ids to exclude even if otherwise eligible (e.g. the implementer, when picking a reviewer). */
  exclude?: string[];
}

export interface WorkerSelection {
  agentId: string;
  reason: string;
  scores: Record<string, number>;
}

/**
 * Capability-weighted, workload-aware worker selection — the seam that
 * replaces a fixed "Claude implements, Codex reviews" assignment. Every
 * candidate gets a score from its capability weights averaged over the
 * task's required capabilities; active workload and an existing file-scope
 * conflict both push the score down. The routing reason is returned
 * verbatim so callers can persist it for auditability.
 */
export async function selectWorker(input: SelectWorkerInput): Promise<WorkerSelection> {
  const candidates = input.candidates.filter((id) => !input.exclude?.includes(id));
  if (candidates.length === 0) throw new Error("No worker candidates available");

  const scores: Record<string, number> = {};
  const reasons: string[] = [];

  for (const agentId of candidates) {
    const weights = await getCapabilityWeights(agentId);
    const relevant = input.requiredCapabilities.length ? input.requiredCapabilities : (Object.keys(weights) as AgentCapabilityKey[]);
    const capabilityScore = relevant.length
      ? relevant.reduce((sum, key) => sum + (weights[key] ?? 0.5), 0) / relevant.length
      : 0.5;
    const workload = await currentWorkload(input.chatRoomId, agentId);
    const workloadPenalty = workload * 0.12;
    const conflicted = await hasFileConflict(input.chatRoomId, agentId, input.fileScope ?? []);
    const conflictPenalty = conflicted ? 0.5 : 0;
    scores[agentId] = Math.max(0, capabilityScore - workloadPenalty - conflictPenalty);
    reasons.push(`${agentId}: capability=${capabilityScore.toFixed(2)} workload=${workload} (-${workloadPenalty.toFixed(2)}) conflict=${conflicted ? "yes" : "no"} (-${conflictPenalty.toFixed(2)})`);
  }

  const [best] = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const others = candidates.filter((id) => id !== best[0]);
  return {
    agentId: best[0],
    reason: `Selected ${best[0]} (score ${best[1].toFixed(2)})${others.length ? ` over ${others.join(", ")}` : ""}. ${reasons.join("; ")}`,
    scores,
  };
}
