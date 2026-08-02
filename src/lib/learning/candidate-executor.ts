// Candidate execution contract for shadow mode.
//
// The prior shadow implementation scored a candidate by checking whether
// the *historical baseline* Experience succeeded — never touching the
// candidate's own proposed artifact. For code-bearing candidates it
// validated the literal no-op command `["true"]` instead of the real
// `implementationCommand` already present on the payload (and already
// executed once, successfully, earlier in the safe-skill-generation
// pipeline — see runSkillGenerationPipeline in skill-generation.ts). That
// meant five historically-successful fixtures could produce promotion
// confidence for a candidate that would regress or fail outright.
//
// Every executor here evaluates the CANDIDATE's real proposed artifact
// against a real recorded fixture — either by actually running it (Skill,
// via the same sandbox boundary already used elsewhere) or by deterministically
// replaying real historical data through the candidate's real proposed logic
// (ToolPolicy, PromptChange). A candidate type with no executor is
// `unsupported` and must never contribute to promotion confidence.

import type { LearningCandidate } from "@prisma/client";
import { getSandbox } from "./sandbox";

export interface ShadowFixture {
  experienceId: string;
  objective: string;
  contextSnapshot: unknown;
  actionsTaken: unknown;
  toolsUsed: string[];
  outcomeStatus: string | null;
  evaluatorScore: number | null;
}

export interface PreparedCandidate {
  candidateId: string;
  type: string;
  artifact: unknown;
  /** Set by prepare() when the candidate's payload doesn't actually carry an executable/comparable artifact for this executor. */
  prepareError?: string;
}

export interface CandidateExecutionInput {
  prepared: PreparedCandidate;
  fixture: ShadowFixture;
}

export interface CandidateExecutionResult {
  executed: boolean;
  passed: boolean;
  score: number | null;
  reasons: string[];
  safetyViolation: boolean;
}

export interface CandidateExecutor {
  readonly name: string;
  supports(candidate: LearningCandidate): boolean;
  prepare(candidate: LearningCandidate): Promise<PreparedCandidate>;
  execute(input: CandidateExecutionInput): Promise<CandidateExecutionResult>;
  cleanup(prepared: PreparedCandidate): Promise<void>;
}

function payloadOf(candidate: LearningCandidate): Record<string, unknown> {
  return candidate.proposedPayload as Record<string, unknown>;
}

// --- Skill: real sandboxed execution of the real implementation command ---
//
// Mirrors the exact artifact shape the safe-skill-generation pipeline
// already established (payload.implementationCommand, a real argv array —
// see skill-generation.ts's runSkillGenerationPipeline). Only candidates
// carrying that real command are supported; a "skill" candidate without one
// (e.g. a manually-proposed skill with no governed pipeline behind it) is
// correctly left unsupported rather than faked.
export const skillCandidateExecutor: CandidateExecutor = {
  name: "skill-sandbox",

  supports(candidate) {
    if (candidate.type !== "skill") return false;
    const payload = payloadOf(candidate);
    return Array.isArray(payload.implementationCommand) && payload.implementationCommand.length > 0;
  },

  async prepare(candidate) {
    const payload = payloadOf(candidate);
    const command = payload.implementationCommand;
    if (!Array.isArray(command) || command.some((c) => typeof c !== "string") || command.length === 0) {
      return { candidateId: candidate.id, type: candidate.type, artifact: null, prepareError: "implementationCommand missing or malformed" };
    }
    return { candidateId: candidate.id, type: candidate.type, artifact: command as string[] };
  },

  async execute({ prepared, fixture }) {
    if (prepared.prepareError || !prepared.artifact) {
      return { executed: false, passed: false, score: null, reasons: [prepared.prepareError ?? "no artifact"], safetyViolation: false };
    }
    const command = prepared.artifact as string[];
    const sandbox = getSandbox();
    if (!sandbox.isProductionSafe && process.env.NODE_ENV !== "test") {
      return {
        executed: false,
        passed: false,
        score: null,
        reasons: ["no production-safe sandbox backend configured — refusing to treat this as executed"],
        safetyViolation: false,
      };
    }
    const validation = await sandbox.validate({ command });
    if (!validation.valid) {
      return { executed: true, passed: false, score: 0, reasons: validation.reasons, safetyViolation: true };
    }
    // Fixture context is passed through the sandbox's explicit env allowlist
    // (never inherited host env) so an implementation that reads it can vary
    // its behavior per fixture; an implementation that ignores it still gets
    // a real, repeated, real-exit-code execution rather than a fixed no-op.
    const run = await sandbox.execute({
      command,
      env: {
        SHADOW_FIXTURE_EXPERIENCE_ID: fixture.experienceId,
        SHADOW_FIXTURE_OBJECTIVE: fixture.objective.slice(0, 4096),
      },
    });
    await sandbox.destroy(run.runId).catch(() => {});
    const passed = run.status === "completed" && run.exitCode === 0;
    // A non-zero exit is the candidate's own logic failing — real evidence
    // against promotion, but not a sandbox-boundary violation. Only a run
    // that never produced an exit code at all (spawn failure, timeout,
    // output-limit kill — exitCode stays null) is a boundary/safety issue.
    const safetyViolation = run.exitCode === null;
    return {
      executed: true,
      passed,
      score: passed ? 1 : 0,
      reasons: passed ? [] : [run.reason ?? (run.stderr || `sandbox exited ${run.exitCode}`)],
      safetyViolation,
    };
  },

  async cleanup() {
    // sandbox.destroy() already called per-execution above; nothing else to release.
  },
};

// --- Tool policy change: replay real historical tool usage through the ---
// --- candidate's real proposed permission list. No sandbox needed — this ---
// --- is deterministic authorization-logic replay over real recorded data. ---
export const toolPolicyCandidateExecutor: CandidateExecutor = {
  name: "tool-policy-replay",

  supports(candidate) {
    if (candidate.type !== "tool_policy_change") return false;
    const payload = payloadOf(candidate);
    return Array.isArray(payload.toolPermissions);
  },

  async prepare(candidate) {
    const payload = payloadOf(candidate);
    const permissions = payload.toolPermissions;
    if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== "string")) {
      return { candidateId: candidate.id, type: candidate.type, artifact: null, prepareError: "toolPermissions missing or malformed" };
    }
    return { candidateId: candidate.id, type: candidate.type, artifact: permissions as string[] };
  },

  async execute({ prepared, fixture }) {
    if (prepared.prepareError || !prepared.artifact) {
      return { executed: false, passed: false, score: null, reasons: [prepared.prepareError ?? "no artifact"], safetyViolation: false };
    }
    const newPermissions = new Set(prepared.artifact as string[]);
    const usedTools = fixture.toolsUsed ?? [];
    if (usedTools.length === 0) {
      // Nothing to replay against — this fixture provides no evidence either way.
      return { executed: true, passed: true, score: null, reasons: ["fixture recorded no tool usage — no evidence"], safetyViolation: false };
    }
    const revoked = usedTools.filter((tool) => !newPermissions.has(tool) && !newPermissions.has("*"));
    const passed = revoked.length === 0;
    return {
      executed: true,
      passed,
      score: passed ? 1 : 0,
      reasons: passed
        ? []
        : [`candidate's proposed permissions would revoke real tool usage from this fixture: ${revoked.join(", ")}`],
      safetyViolation: false,
    };
  },

  async cleanup() {},
};

// --- Prompt change: structural regression check of the real proposed ---
// --- prompt against the real current one. No live model call (shadow ---
// --- mode is network-denied by design), but a genuine diff of the real ---
// --- artifact, not a proxy for historical baseline success. ---
export const promptChangeCandidateExecutor: CandidateExecutor = {
  name: "prompt-structural-diff",

  supports(candidate) {
    if (candidate.type !== "prompt_change") return false;
    const payload = payloadOf(candidate);
    return typeof payload.systemPrompt === "string" && typeof payload.agentId === "string";
  },

  async prepare(candidate) {
    const payload = payloadOf(candidate);
    const newPrompt = payload.systemPrompt as string;
    const agentId = payload.agentId as string;
    if (!newPrompt.trim()) {
      return { candidateId: candidate.id, type: candidate.type, artifact: null, prepareError: "systemPrompt is empty" };
    }
    return { candidateId: candidate.id, type: candidate.type, artifact: { newPrompt, agentId } };
  },

  async execute({ prepared }) {
    if (prepared.prepareError || !prepared.artifact) {
      return { executed: false, passed: false, score: null, reasons: [prepared.prepareError ?? "no artifact"], safetyViolation: false };
    }
    const { newPrompt, agentId } = prepared.artifact as { newPrompt: string; agentId: string };
    const { db } = await import("@/lib/db");
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { systemPrompt: true } });
    const currentPrompt = agent?.systemPrompt ?? "";
    const reasons: string[] = [];

    if (newPrompt.trim().length < 20) {
      reasons.push("proposed prompt is implausibly short (<20 chars) for a system prompt");
    }
    // A crude but real regression signal: safety/boundary-relevant sentences
    // present in the current prompt that vanish entirely from the proposed
    // one. Not semantic understanding — a real, deterministic check of the
    // real artifact, not a fake pass.
    const boundaryPhrases = (currentPrompt.match(/\b(never|do not|must not|refuse|prohibited)\b[^.]{0,80}\./gi) ?? []);
    const droppedPhrases = boundaryPhrases.filter((phrase) => !newPrompt.includes(phrase));
    if (droppedPhrases.length > 0) {
      reasons.push(
        `proposed prompt drops ${droppedPhrases.length} explicit boundary/safety clause(s) present in the current prompt`,
      );
    }

    const passed = reasons.length === 0;
    return { executed: true, passed, score: passed ? 1 : 0, reasons, safetyViolation: droppedPhrases.length > 0 };
  },

  async cleanup() {},
};

const EXECUTORS: CandidateExecutor[] = [skillCandidateExecutor, toolPolicyCandidateExecutor, promptChangeCandidateExecutor];

export function findCandidateExecutor(candidate: LearningCandidate): CandidateExecutor | null {
  return EXECUTORS.find((executor) => executor.supports(candidate)) ?? null;
}
