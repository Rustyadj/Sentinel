import type { AgentCapabilityKey } from "./capability-defaults";

/**
 * Capability-based approval policy. Whether an agent task needs a human
 * approval is decided here from structured data only — the runtime that will
 * execute it, the task's declared capabilities, and its file scope — never
 * from the task's title/description, which the agent itself wrote.
 *
 * `assessRisk` (approval-gate.ts) still exists, but only as an escalator: it
 * can raise a displayed risk label or Guardian tier, never lower the
 * requirement computed here.
 */
export type ActionClass = "read" | "write" | "exec" | "external" | "deploy";

const CLASS_RANK: Record<ActionClass, number> = { read: 0, write: 1, exec: 2, external: 3, deploy: 4 };

/** Runtimes that can edit files / run commands in a workspace. */
const WRITE_RUNTIMES = new Set(["claude-code", "codex", "gemini"]);

/** Capabilities whose work is inherently read-only. Anything not listed here
 *  (including capability strings this table doesn't know) counts as write. */
const CAPABILITY_CLASS: Partial<Record<AgentCapabilityKey, ActionClass>> = {
  research: "read",
  devops: "deploy",
};

export interface ActionRuntime {
  kind: string;
  /** Hermes agents run with terminal/file tools unless explicitly declared
   *  otherwise, so only an explicit `false` makes a Hermes runtime read-only. */
  shellCapable?: boolean;
}

export interface ClassifiableTask {
  capabilities: readonly string[];
  fileScope: readonly string[];
}

export function maxClass(a: ActionClass, b: ActionClass): ActionClass {
  return CLASS_RANK[a] >= CLASS_RANK[b] ? a : b;
}

function runtimeClass(runtime: ActionRuntime | null | undefined): ActionClass {
  if (!runtime) return "write";
  if (WRITE_RUNTIMES.has(runtime.kind)) return "write";
  if (runtime.kind === "hermes") return runtime.shellCapable === false ? "read" : "write";
  return "write"; // unknown runtime kind: fail closed
}

export function classifyTaskAction(task: ClassifiableTask, runtime: ActionRuntime | null | undefined): ActionClass {
  let cls = runtimeClass(runtime);
  if (task.fileScope.length > 0) cls = maxClass(cls, "write");
  if (task.capabilities.length === 0) return maxClass(cls, "write"); // no declared capabilities: fail closed
  for (const capability of task.capabilities) {
    cls = maxClass(cls, CAPABILITY_CLASS[capability as AgentCapabilityKey] ?? "write");
  }
  return cls;
}

export interface ApprovalAllowlistEntry {
  runtime: string;
  capability: string;
}

export interface ApprovalContext {
  runtimeKind?: string | null;
  capabilities?: readonly string[];
  /** Per-workspace downgrade pairs. Empty (the default) means no downgrades. */
  allowlist?: readonly ApprovalAllowlistEntry[];
}

/** Classes an allowlist entry may downgrade. Deploy/external stay gated no
 *  matter what is configured. */
const DOWNGRADABLE: ReadonlySet<ActionClass> = new Set(["write", "exec"]);

export function requiresHumanApproval(cls: ActionClass, context: ApprovalContext = {}): boolean {
  if (cls === "read") return false;
  const { runtimeKind, capabilities = [], allowlist = [] } = context;
  if (!DOWNGRADABLE.has(cls) || !runtimeKind || capabilities.length === 0 || allowlist.length === 0) return true;
  const covered = capabilities.every((capability) =>
    allowlist.some((entry) => entry.runtime === runtimeKind && entry.capability === capability));
  return !covered;
}

/**
 * Optional per-workspace allowlist, read from SENTINEL_APPROVAL_ALLOWLIST:
 * a JSON object of workspaceId -> [{ runtime, capability }]. Missing,
 * malformed, or unmatched config yields an empty list (no downgrades).
 */
export function workspaceApprovalAllowlist(workspaceId: string | null | undefined, raw = process.env.SENTINEL_APPROVAL_ALLOWLIST): ApprovalAllowlistEntry[] {
  if (!workspaceId || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = parsed?.[workspaceId];
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is ApprovalAllowlistEntry =>
      typeof entry?.runtime === "string" && typeof entry?.capability === "string");
  } catch {
    return [];
  }
}

type RiskLabel = "low" | "medium" | "high";
const RISK_RANK: Record<RiskLabel, number> = { low: 0, medium: 1, high: 2 };

/** Floor for the risk label shown on an approval request. */
export function displayRiskFloor(cls: ActionClass): RiskLabel {
  if (cls === "deploy" || cls === "external") return "high";
  if (cls === "read") return "low";
  return "medium";
}

/**
 * Risk level handed to Guardian. Deploy/external are always tier 3 (which a
 * prior human approval clears); read/write/exec keep the keyword escalator's
 * level so ordinary coding tasks aren't double-gated by a tier-2 hold on top
 * of the approval they already need.
 */
export function guardianRiskFloor(cls: ActionClass): RiskLabel {
  return cls === "deploy" || cls === "external" ? "high" : "low";
}

/** Escalate-only merge: the result is never lower than `floor`. */
export function escalateRisk(floor: RiskLabel, keywordRisk: RiskLabel): RiskLabel {
  return RISK_RANK[keywordRisk] > RISK_RANK[floor] ? keywordRisk : floor;
}
