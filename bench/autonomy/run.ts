/**
 * Autonomy benchmark — policy level, deterministic.
 *
 *   npx tsx bench/autonomy/run.ts
 *
 * Replays one seeded corpus of objectives and room tasks through two rule
 * sets and counts the human touches each one needs:
 *
 *   baseline  = the rules on main@d2b7e4e: every non-read room task needs a
 *               per-action approval (no allowlist), objectives default to
 *               Supervised (level 2), Supervised/Managed objectives get 1/2
 *               attempts, Lisa stops at 25 turns.
 *   autonomy  = this branch: standing grants (a typical setup: routine work
 *               in the workspace, publish in one project — nothing for
 *               deploy/financial/destructive/credential), Managed default
 *               (level 3), recovery budget 4, 60-turn orchestration budget.
 *
 * What this measures is how many times each policy would stop and ask a
 * human, and how many objectives would finish unattended under simulated
 * failures. It does NOT run models, so it says nothing about output quality;
 * live numbers come from GET /api/autonomy/metrics.
 */
import { allowedAttempts, decideStep } from "../../src/lib/objectives/policy";
import type { AutonomyLevel, StepImpact, StepKind } from "../../src/lib/objectives/types";
import { classifyTaskAction } from "../../src/lib/orchestration/action-policy";
import { evaluateAuthority, operationForStep, type AuthorityGrantLike } from "../../src/lib/autonomy/authority";
import { requiredTaskOperation } from "../../src/lib/autonomy/task-authority-rules";
import { composePrompt } from "../../src/lib/autonomy/prompt-composer";
import { AUTONOMY_DIRECTIVE, AUTONOMY_DIRECTIVE_VERSION } from "../../src/lib/autonomy/directive";
import { summarizeAuthority } from "../../src/lib/autonomy/authority-summary";
import { findRedundantRestrictions } from "../../src/lib/autonomy/prompt-layers";

let seed = 20261127;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];

const WS = "bench-ws";
const now = new Date("2026-11-27T12:00:00Z");
const base: Omit<AuthorityGrantLike, "id" | "operations"> = {
  workspaceId: WS, projectId: null, agentId: null, roomId: null, objectiveId: null, capabilities: [], runtimes: [], maxUses: null, usesCount: 0,
  budgetCents: null, spentCents: 0, period: null, periodMaxUses: null, periodStartedAt: null, periodUses: 0, startsAt: null, expiresAt: null, revokedAt: null,
};
const GRANTS: AuthorityGrantLike[] = [
  { ...base, id: "routine", operations: ["routine"] },
  { ...base, id: "publish-site", operations: ["publish"], projectId: "site" },
];

// ---- corpus -------------------------------------------------------------
interface BenchStep { kind: StepKind; impact: StepImpact; failures: number; cost: number }
interface BenchObjective { steps: BenchStep[]; turnsNeeded: number }
const IMPACTS: StepImpact[] = ["read", "read", "read", "write", "write", "write", "publish", "financial", "destructive"];
const objectives: BenchObjective[] = Array.from({ length: 50 }, () => ({
  turnsNeeded: 8 + Math.floor(rand() * 40),
  steps: Array.from({ length: 4 + Math.floor(rand() * 8) }, (): BenchStep => {
    const impact = pick(IMPACTS);
    return { kind: rand() < 0.3 ? "agent" : "tool", impact, failures: rand() < 0.25 ? 1 + Math.floor(rand() * 3) : 0, cost: impact === "financial" ? 1500 : 0 };
  }),
}));
const TITLES = ["Add pagination to the list endpoint", "Write tests for the parser", "Refactor the import module", "Fix the flaky date test", "Rotate the API key used by billing", "rm -rf the stale build cache", "Deploy the preview to production", "Research rate-limit libraries"];
const CAPS = [["backend"], ["testing"], ["frontend"], ["research"], ["backend", "testing"], ["devops"]];
const tasks = Array.from({ length: 120 }, () => ({ title: pick(TITLES), capabilities: pick(CAPS), project: pick(["site", "ops"]) }));

// ---- objectives ---------------------------------------------------------
function runObjectives(mode: "baseline" | "autonomy") {
  let approvals = 0, unattended = 0, recovered = 0, failedSteps = 0, budgetStops = 0;
  const level: AutonomyLevel = mode === "baseline" ? 2 : 3;
  for (const objective of objectives) {
    let asked = 0, stuck = false;
    for (const step of objective.steps) {
      const decision = decideStep({ level, kind: step.kind, impact: step.impact, estimatedCostCents: step.cost, spentCents: 0, budgetCents: 10_000 });
      if (decision.action === "approve") {
        // Same request shape the engine sends (objectives carry no projectId).
        const covered = mode === "autonomy" && decision.code !== "budget" && decision.code !== "supervised"
          && evaluateAuthority({ workspaceId: WS, agentId: "objective", objectiveId: "o", operation: operationForStep(step.impact, step.kind), costCents: step.cost }, GRANTS, now).authorized;
        if (!covered) asked += 1;
      }
      // baseline (main): Supervised gets 1 attempt. autonomy: allowedAttempts with the default recovery budget, step max 3.
      const attempts = mode === "baseline" ? 1 : allowedAttempts(level, 3);
      if (step.failures > 0) {
        failedSteps += 1;
        if (step.failures < attempts) recovered += 1; else stuck = true;
      }
    }
    const turnBudget = mode === "baseline" ? 25 : 60;
    if (objective.turnsNeeded > turnBudget) { budgetStops += 1; stuck = true; }
    approvals += asked;
    if (!asked && !stuck) unattended += 1;
  }
  return { approvalsPerObjective: +(approvals / objectives.length).toFixed(2), unattendedCompletionRate: +(unattended / objectives.length).toFixed(2), failureRecoveryRate: +(recovered / Math.max(1, failedSteps)).toFixed(2), orchestrationBudgetStops: budgetStops };
}

// ---- room tasks ---------------------------------------------------------
function runTasks(mode: "baseline" | "autonomy") {
  let approvals = 0;
  for (const task of tasks) {
    const cls = classifyTaskAction({ capabilities: task.capabilities, fileScope: ["src/**"] }, { kind: "codex" });
    if (cls === "read") continue;
    if (mode === "baseline") { approvals += 1; continue; }
    const operation = requiredTaskOperation(cls, task.title);
    const covered = evaluateAuthority({ workspaceId: WS, agentId: "codex", projectId: task.project, operation, capabilities: task.capabilities, runtime: "codex" }, GRANTS, now).authorized;
    if (!covered) approvals += 1;
  }
  return { approvalRequests: approvals, approvalsPerTask: +(approvals / tasks.length).toFixed(2) };
}

// ---- prompt overhead ----------------------------------------------------
function promptOverhead() {
  const directive = { id: "directive" as const, source: "sentinel" as const, version: AUTONOMY_DIRECTIVE_VERSION, content: AUTONOMY_DIRECTIVE };
  const authority = { id: "authority" as const, source: "sentinel" as const, content: summarizeAuthority("codex", WS, GRANTS, now) };
  const turn = (i: number) => ({ id: "task" as const, source: "runtime" as const, content: `turn ${i}` });
  const first = composePrompt([directive, authority, turn(0)]);
  const delivered = new Set([first.layers[0].hash]);
  const statefulTotal = first.sentinelChars + Array.from({ length: 9 }, (_, i) => composePrompt([directive, authority, turn(i + 1)], { alreadyInContext: delivered }).sentinelChars).reduce((a, b) => a + b, 0);
  return {
    sentinelCharsPerTurnStateless: first.sentinelChars,
    sentinelCharsPer10TurnsStateful: statefulTotal,
    sentinelRestrictionFindings: findRedundantRestrictions(first.sentinelText).length,
  };
}

const report = {
  corpus: { objectives: objectives.length, steps: objectives.reduce((n, o) => n + o.steps.length, 0), roomTasks: tasks.length },
  objectives: { baseline: runObjectives("baseline"), autonomy: runObjectives("autonomy") },
  roomTasks: { baseline: runTasks("baseline"), autonomy: runTasks("autonomy") },
  prompt: { baseline: { sentinelCharsPerTurn: 0, note: "main injected no directive, but also delivered no agent identity" }, autonomy: promptOverhead() },
};
console.log(JSON.stringify(report, null, 2));
