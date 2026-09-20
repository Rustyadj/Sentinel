// Sentinel — the single governed entry point for "give this worker memory".
//
// Every runtime goes through here: the built-in chat route, orchestration runs
// dispatched to Hermes Nathan2 / Hermes Lisa / Claude Code / Codex, and the
// MCP tools external clients call. Sentinel is the memory authority; no
// adapter is permitted to assemble its own context or query memory directly.
//
// It composes three things that already existed but were never joined up:
//
//   retrieveContextWithProvenance  — scoped retrieval + KnowledgeObject bridging
//   assembleContext                — bounded, ordered, attributable prompt block
//   recordMemoryRetrieval          — what was retrieved AND what was injected
//
// The ordering matters: usage is recorded *after* assembly, so the `injected`
// flag reflects what survived the token budget rather than what was merely
// fetched.

import { retrieveContextWithProvenance } from "./knowledge-bridge";
import { assembleContext, withMemoryContext, type AssembledContext, DEFAULT_CONTEXT_TOKEN_BUDGET } from "./context-assembly";
import { recordMemoryRetrieval } from "./memory-usage-service";
import type { RetrievalContext } from "@/lib/knowledge/types";

export type MemoryConsumer = "chat" | "orchestration" | "mcp" | "task";

export interface BuildMemoryContextOptions {
  /** Which surface is asking. Recorded per retrieval so quality can be measured per surface. */
  consumer: MemoryConsumer;
  tokenBudget?: number;
  /** Ties retrievals to an experience so reconsolidation can resolve them later. */
  experienceId?: string | null;
  runId?: string | null;
}

export interface MemoryContextResult {
  /** The rendered block. Empty when there was nothing relevant. */
  context: AssembledContext;
  /** KnowledgeObject ids, for Experience.knowledgeUsed / OrchestrationRun.retrievedObjectIds. */
  knowledgeObjectIds: string[];
  /** Everything retrieved, before the budget was applied. */
  retrievedMemoryIds: string[];
}

/**
 * Retrieve, assemble and record — in that order.
 *
 * Fully self-guarded: memory is an enhancement to a worker's prompt, never a
 * precondition for running it. If anything here fails the caller gets an empty
 * context and the task proceeds exactly as it did before memory existed.
 */
export async function buildMemoryContext(
  ctx: RetrievalContext,
  options: BuildMemoryContextOptions,
): Promise<MemoryContextResult> {
  const empty: MemoryContextResult = {
    context: { text: "", injected: [], droppedMemoryIds: [], estimatedTokens: 0 },
    knowledgeObjectIds: [],
    retrievedMemoryIds: [],
  };

  try {
    const retrieved = await retrieveContextWithProvenance({ ...ctx, skipUsageRecording: true });

    // Redis-backed session turns carry synthetic `session:<roomId>:<n>` ids and
    // have no Memory row. They are legitimate context but can never be recorded
    // as retrievals — a foreign key would reject them and roll back the batch.
    const durable = retrieved.memories.filter((memory) => memory.scope !== "session");

    const context = assembleContext(
      {
        memories: retrieved.memories,
        notes: retrieved.notes,
        decisions: retrieved.decisions,
      },
      { tokenBudget: options.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET },
    );

    const durableIds = new Set(durable.map((memory) => memory.id));
    await recordMemoryRetrieval({
      memoryIds: durable.map((memory) => memory.id),
      injected: context.injected.filter((record) => durableIds.has(record.memoryId)),
      consumer: options.consumer,
      userId: ctx.userId,
      projectId: ctx.projectId ?? null,
      workspaceId: ctx.workspaceId ?? null,
      experienceId: options.experienceId ?? ctx.experienceId ?? null,
      runId: options.runId ?? null,
    });

    return {
      context,
      knowledgeObjectIds: retrieved.knowledgeObjectIds,
      retrievedMemoryIds: durable.map((memory) => memory.id),
    };
  } catch {
    return empty;
  }
}

export { withMemoryContext };
