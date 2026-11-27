import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ComposedPrompt } from "./prompt-composer";

export interface RecordCompositionInput {
  agentId: string;
  workspaceId?: string | null;
  surface: string;
  composed: ComposedPrompt;
}

/**
 * Persist the composition for inspection. Content-addressed: a stack that was
 * already recorded just bumps its use counter. Observability must never break
 * the turn it observes, so failures are logged and swallowed.
 */
export async function recordComposition(input: RecordCompositionInput): Promise<void> {
  const now = new Date();
  try {
    await db.promptComposition.upsert({
      where: { hash: `${input.surface}:${input.agentId}:${input.composed.hash}` },
      create: {
        hash: `${input.surface}:${input.agentId}:${input.composed.hash}`,
        agentId: input.agentId,
        workspaceId: input.workspaceId ?? null,
        surface: input.surface,
        layers: input.composed.layers as unknown as object,
        sentinelText: input.composed.sentinelText,
        totalChars: input.composed.totalChars,
        sentinelChars: input.composed.sentinelChars,
      },
      update: { useCount: { increment: 1 }, lastUsedAt: now },
    });
  } catch (error) {
    logger.warn("autonomy.prompt_composition_record_failed", { error: error instanceof Error ? error.message : String(error), agentId: input.agentId, surface: input.surface });
  }
}
