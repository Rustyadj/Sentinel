// Sentinel Neural Engine — Phase B: chat-turn experience capture
//
// The seam that makes the learning loop actually RUN in the product. When an
// agent finishes a chat turn, this records it as an Experience + Outcome and
// runs the auto-evaluator (Observe → Act → Measure → Evaluate → Propose).
//
// Hard requirements for living on the critical chat path:
//   1. It must NEVER throw into the request/stream path — fully self-guarded.
//   2. It must never block the response — callers invoke it fire-and-forget.
//
// Note on knowledgeUsed: the current retriever (src/lib/knowledge/retrieval.ts)
// returns content, not KnowledgeObject ids, so chat turns record competency
// but pass an empty knowledgeUsed today. Wiring real provenance ids (so chat
// success/failure strengthens/weakens specific objects) is Phase C — the
// evaluator already handles a populated knowledgeUsed; only the chat caller is
// currently id-less. Tests exercise the populated path directly.

import { db } from "@/lib/db";
import { startExperience, completeExperience } from "./experience-service";
import { autoEvaluateExperience } from "./evaluator";

export interface AgentTurnCapture {
  agentId: string;
  roomId?: string;
  userContent: string;
  model: string;
  /** Date.now() captured just before the model call started. */
  startedAtMs: number;
  /** The assistant's full response text (empty ⇒ the turn produced nothing). */
  fullContent: string;
  knowledgeUsedIds?: string[];
}

/**
 * Record a completed agent chat turn as an Experience and run the evaluator.
 * Returns the created experience id on success, or null if capture was skipped
 * or failed (both are non-fatal).
 */
export async function captureAgentTurn(input: AgentTurnCapture): Promise<string | null> {
  try {
    if (!input.agentId || !input.userContent) return null;

    const latencyMs = Math.max(0, Math.round(Date.now() - input.startedAtMs));

    let projectId: string | null = null;
    if (input.roomId) {
      const room = await db.chatRoom
        .findUnique({ where: { id: input.roomId }, select: { projectId: true } })
        .catch(() => null);
      projectId = room?.projectId ?? null;
    }

    const succeeded = input.fullContent.trim().length > 0;

    const experience = await startExperience({
      agentId: input.agentId,
      projectId,
      conversationId: input.roomId ?? null,
      objective: input.userContent.slice(0, 500),
      contextSnapshot: { model: input.model, source: "chat" },
      knowledgeUsed: input.knowledgeUsedIds ?? [],
    });

    await completeExperience({
      experienceId: experience.id,
      outcome: {
        status: succeeded ? "success" : "failure",
        metrics: { responseChars: input.fullContent.length },
        errors: succeeded ? [] : ["empty_response"],
      },
      latencyMs,
    });

    await autoEvaluateExperience(experience.id);

    return experience.id;
  } catch (err) {
    // Best-effort telemetry — never break chat.
    console.error("[neural] captureAgentTurn failed (non-fatal):", err);
    return null;
  }
}
