import { db } from "@/lib/db";
import { evaluateGuardian } from "@/lib/learning/guardian";
import { assessRisk, requestApprovalGate } from "./approval-gate";
import { emitCollaborationEvent } from "./event-bus";
import { parseDirectives, runLisaLoop } from "./lisa-loop";
import { postCollaborationMessage } from "./messages";

/**
 * The only tool name this bridge recognizes in a plain (non-loop) Lisa
 * reply. Deliberately outside LisaTool's menu — that menu is dispatched
 * only from inside runLisaLoop's own reasoning turns; this one is parsed
 * from Lisa's direct/solo-mode chat reply, before the loop has even
 * started, to decide whether the loop should start at all.
 */
export const MISSION_LAUNCH_TOOL = "launchImplementationMission";

/** Explicit, constrained worker pool for this launch path — never grown
 *  silently (e.g. to include Nathan2) just because a room happens to have
 *  other agents configured. */
export const DEFAULT_MISSION_WORKERS = ["claude-code", "codex"] as const;
const ALLOWED_MISSION_WORKERS = new Set<string>(DEFAULT_MISSION_WORKERS);

/**
 * Prepended to the prompt sent to Hermes Lisa for a direct/solo-mode chat
 * reply (never for the in-loop reasoning turns, which have their own
 * TOOL_MENU). Gives Lisa the explicit vocabulary to request a multi-worker
 * implementation mission — deliberately, not via keyword sniffing on her
 * output. Ordinary conversation gets an ordinary reply and no directive.
 */
export const MISSION_DIRECTIVE_PROMPT = `You are Hermes Lisa, Sentinel's lead agent, replying directly to the user in a one-on-one chat. This is NOT the multi-worker orchestration loop — Claude Code and Codex are not running yet.

Reply to the user normally and helpfully.

Separately: if, and only if, the user is explicitly asking you to carry out a real software implementation task — writing code, fixing a bug, building a feature — that should be done for real by Sentinel's Claude Code and Codex workers, end your reply with a fenced json code block containing exactly this one directive:

\`\`\`json
[{"tool": "${MISSION_LAUNCH_TOOL}", "args": {"objective": "<one-sentence restatement of what to build or fix>"}}]
\`\`\`

Only emit this block when you have deliberately decided the user wants a real implementation mission launched right now. Never emit it for ordinary conversation, questions, planning talk, or anything that doesn't require code to actually be written. If you're not launching a mission, omit the block entirely — do not emit an empty, placeholder, or speculative one.`;

export type MissionBridgeOutcome =
  | { status: "no_directive" }
  | { status: "malformed" }
  | { status: "launched"; workers: string[] }
  | { status: "pending_approval"; approvalId: string }
  | { status: "blocked"; reasonCodes: string[] };

interface ParsedMissionDirective {
  objective: string;
  workers: string[];
}

function extractMissionDirective(replyText: string): ParsedMissionDirective | null | "malformed" {
  const directives = parseDirectives(replyText);
  if (!directives) return null;
  const directive = directives.find((d) => d.tool === MISSION_LAUNCH_TOOL);
  if (!directive) return null;

  const objective = typeof directive.args.objective === "string" ? directive.args.objective.trim().slice(0, 2_000) : "";
  if (!objective) return "malformed";

  const rawWorkers = directive.args.workers;
  if (rawWorkers === undefined) return { objective, workers: [...DEFAULT_MISSION_WORKERS] };
  if (!Array.isArray(rawWorkers) || rawWorkers.length === 0) return "malformed";
  const workers = rawWorkers.filter((w): w is string => typeof w === "string");
  if (workers.length !== rawWorkers.length) return "malformed";
  if (!workers.every((w) => ALLOWED_MISSION_WORKERS.has(w))) return "malformed"; // e.g. a stray "nathan2" — never silently added
  return { objective, workers };
}

export interface EvaluateMissionDirectiveInput {
  roomId: string;
  userId: string;
  /** The lead (hermes) agent id whose reply is being parsed — never a worker's. */
  leadAgentId: string;
  replyText: string;
}

/**
 * The chat -> multi-worker orchestration bridge. Called after a direct/solo
 * Lisa chat reply comes back. Ordinary conversation (no directive, or one
 * for a different tool) does nothing — runLisaLoop is never reached. Only
 * an explicit launchImplementationMission directive gets Guardian-evaluated
 * and, if and only if Guardian allows it, launches the loop with the
 * explicit ["claude-code", "codex"] pool.
 */
export async function evaluateMissionDirective(input: EvaluateMissionDirectiveInput): Promise<MissionBridgeOutcome> {
  const parsed = extractMissionDirective(input.replyText);
  if (parsed === null) return { status: "no_directive" };
  if (parsed === "malformed") return { status: "malformed" };

  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: input.roomId } });
  const risk = assessRisk(parsed.objective);
  const evaluation = await evaluateGuardian({
    action: parsed.objective, actor: input.leadAgentId, runtime: "mission-bridge", riskLevel: risk,
  });

  if (evaluation.verdict === "allow") {
    await runLisaLoop({
      roomId: input.roomId, userId: input.userId, lead: input.leadAgentId, pool: parsed.workers,
      objective: room.objective, seed: `User requested an implementation mission: ${parsed.objective}`,
    });
    return { status: "launched", workers: parsed.workers };
  }

  // `mode` (TIER_MODE[tier]) is derived purely from risk tier and says
  // nothing about `verdict` — a hard-block pattern match at tier-2 risk
  // still reports mode "review" even though verdict is "block". So the
  // approval-vs-terminal-block branch below keys off `verdict` (the actual
  // decision), using `mode === "review"` only to confirm a "hold" is a
  // genuine tier-2 review gate, never as a substitute for checking verdict.
  const needsTier3Approval = evaluation.decision.reasonCodes.includes("tier3_requires_human_approval");
  const isGenuineHold = evaluation.verdict === "hold" && evaluation.mode === "review";
  if (needsTier3Approval || isGenuineHold) {
    const approval = await requestApprovalGate({
      chatRoomId: input.roomId, requesterAgentId: input.leadAgentId,
      title: "Guardian review required: implementation mission",
      description: parsed.objective, command: parsed.objective,
      extraPayload: {
        missionLaunch: true, objective: parsed.objective, workers: parsed.workers, leadAgentId: input.leadAgentId,
        ...(isGenuineHold ? { guardianDecisionId: evaluation.decision.id } : {}),
      },
    });
    await emitCollaborationEvent(input.roomId, "mission.approval_requested", {
      approvalId: approval.id, risk, guardianTier: evaluation.tier, guardianDecisionId: evaluation.decision.id,
    });
    return { status: "pending_approval", approvalId: approval.id };
  }

  // Hard block — deterministic pattern or self-elevation (or tier-3 with no
  // prior human authorization, already excluded above). Terminal: no
  // approval path, mirrors ensureGuardianCleared's task-level hard block.
  await emitCollaborationEvent(input.roomId, "mission.blocked", {
    reason: "guardian_block", reasonCodes: evaluation.decision.reasonCodes, guardianDecisionId: evaluation.decision.id,
  });
  await postCollaborationMessage({
    chatRoomId: input.roomId, senderAgentId: input.leadAgentId, recipientAgentIds: ["user"], type: "BLOCKER",
    content: `Guardian blocked this implementation mission before launch (${evaluation.decision.reasonCodes.join(", ")}). It will not run.`,
  });
  return { status: "blocked", reasonCodes: evaluation.decision.reasonCodes };
}
