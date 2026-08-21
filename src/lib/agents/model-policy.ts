/**
 * Centralized model/effort policy for Sentinel-managed Claude Code and
 * Codex executions — the one authoritative source, so this never gets
 * duplicated in frontend components, API routes, runtime adapters, or task
 * creation code. Display name (what Sentinel shows an operator) is tracked
 * separately from runtime id (what's actually passed to the CLI), because a
 * friendly product name like "Claude Sonnet 5" is not guaranteed to be the
 * literal identifier an installed CLI/provider accepts — the runtime ids
 * below are Sentinel's best-effort mapping and, like the auth/version args
 * documented in runtime/claude-code.ts and runtime/codex.ts, are
 * intentionally left unverified until scripts/vps-acceptance-test.sh is run
 * against the real installed CLIs.
 */

export type ManagedWorkerKind = "claude-code" | "codex";
export type EffortLevel = "low" | "medium" | "high";

export interface WorkerModelConfig {
  displayName: string;
  runtimeModelId: string;
  effort: EffortLevel;
}

const BUILT_IN_DEFAULTS: Record<ManagedWorkerKind, WorkerModelConfig> = {
  "claude-code": { displayName: "Claude Sonnet 5", runtimeModelId: "claude-sonnet-5", effort: "high" },
  codex: { displayName: "GPT-5.6 Sol", runtimeModelId: "gpt-5.6-sol", effort: "high" },
};

function isEffortLevel(value: string | undefined): value is EffortLevel {
  return value === "low" || value === "medium" || value === "high";
}

function envEffort(name: string, fallback: EffortLevel): EffortLevel {
  const value = process.env[name]?.toLowerCase();
  return isEffortLevel(value) ? value : fallback;
}

export function isManagedWorkerKind(kind: string): kind is ManagedWorkerKind {
  return kind === "claude-code" || kind === "codex";
}

/**
 * Resolves the model/effort policy for one managed worker kind. Environment
 * overrides win over the built-in default; the display name is never
 * overridden by env (it's a label, not a runtime setting) — SENTINEL_CLAUDE_
 * DEFAULT_MODEL/_EFFORT and SENTINEL_CODEX_DEFAULT_MODEL/_EFFORT only ever
 * change the runtime id / effort actually requested.
 */
export function resolveWorkerModel(kind: ManagedWorkerKind): WorkerModelConfig {
  const defaults = BUILT_IN_DEFAULTS[kind];
  if (kind === "claude-code") {
    return {
      displayName: defaults.displayName,
      runtimeModelId: process.env.SENTINEL_CLAUDE_DEFAULT_MODEL ?? defaults.runtimeModelId,
      effort: envEffort("SENTINEL_CLAUDE_DEFAULT_EFFORT", defaults.effort),
    };
  }
  return {
    displayName: defaults.displayName,
    runtimeModelId: process.env.SENTINEL_CODEX_DEFAULT_MODEL ?? defaults.runtimeModelId,
    effort: envEffort("SENTINEL_CODEX_DEFAULT_EFFORT", defaults.effort),
  };
}

/**
 * Best-effort heuristic over a runtime process's stderr: distinguishes "the
 * requested model was rejected by the CLI/provider itself" from an ordinary
 * task failure, so Sentinel can surface a distinguishable MODEL_UNAVAILABLE
 * outcome instead of silently treating it like any other error. Sentinel
 * never substitutes a different model when this fires — a stuck/failed
 * execution is reported as unavailable and left for Lisa or the operator to
 * decide on a fallback, never auto-downgraded.
 */
const REJECTION_WORDS = "(?:not found|not supported|unsupported|unavailable|unknown|invalid|does not exist)";
const MODEL_UNAVAILABLE_PATTERN = new RegExp(
  `\\bmodel\\b[^\\n]{0,80}\\b${REJECTION_WORDS}\\b|\\b${REJECTION_WORDS}\\b[^\\n]{0,80}\\bmodel\\b`,
  "i",
);

export function looksLikeModelUnavailable(stderrText: string): boolean {
  return MODEL_UNAVAILABLE_PATTERN.test(stderrText);
}

/**
 * Thrown instead of a generic failure when the runtime rejected the
 * requested model/effort itself. Deliberately does not carry a list of
 * "available models" — Sentinel has no live way to enumerate a CLI's
 * supported models from here, and fabricating one would violate the same
 * "never substitute demo/fabricated data" rule this codebase already
 * applies elsewhere (see MissionControlPage's explicit source-status UI).
 * Carries enough for a caller (Lisa's loop, a direct reply) to surface a
 * real MODEL_UNAVAILABLE outcome and decide whether to ask the operator for
 * a fallback — never to silently substitute one itself.
 */
export class ModelUnavailableError extends Error {
  constructor(
    public readonly kind: ManagedWorkerKind,
    public readonly requestedModel: string,
    public readonly requestedEffort: EffortLevel,
    public readonly reason: string,
  ) {
    super(`MODEL_UNAVAILABLE: ${kind} rejected requested model "${requestedModel}" (effort: ${requestedEffort}) — ${reason.slice(0, 500)}`);
    this.name = "ModelUnavailableError";
  }
}
