// Bot memory: a policy layer over Sentinel's one memory system. Reads go through
// buildMemoryContext (so scope authorisation, governance exclusions and usage
// recording are the existing ones), writes go through remember() (so the
// ingestion gate and reconsolidation apply). This file only decides *which
// scopes and limits* a given bot gets, and attributes what the bot writes.

import { buildMemoryContext } from "@/lib/neural-engine/memory-context";
import { DEFAULT_CONTEXT_TOKEN_BUDGET } from "@/lib/neural-engine/context-assembly";
import { remember, type RememberResult } from "@/lib/neural-engine/memory-ingestion";
import { canWriteMemoryScope, memoryReadScopes, memoryWriteScopes } from "./policy";
import type { BotRecord } from "./service";
import type { BotMemoryScope } from "./schema";

export interface BotMemoryRead {
  /** Rendered block for the prompt. Empty when nothing relevant was permitted. */
  text: string;
  scopes: BotMemoryScope[];
  retrieved: number;
  injected: number;
  dropped: number;
  estimatedTokens: number;
  /** Why no memory was read, when none was attempted. */
  skipped?: string;
}

export async function readBotMemory(
  bot: Pick<BotRecord, "id" | "memoryPolicy" | "modelConfig">,
  args: { userId: string; query: string; projectId?: string | null; workspaceId?: string | null; runId: string },
): Promise<BotMemoryRead> {
  const scopes = memoryReadScopes(bot.memoryPolicy);
  if (!scopes.length) {
    return { text: "", scopes, retrieved: 0, injected: 0, dropped: 0, estimatedTokens: 0, skipped: bot.memoryPolicy.enabled ? "The bot's policy allows no read scopes." : "Memory is disabled for this bot." };
  }
  const result = await buildMemoryContext(
    {
      userId: args.userId,
      query: args.query,
      projectId: args.projectId ?? undefined,
      workspaceId: args.workspaceId ?? undefined,
      maxItems: bot.memoryPolicy.maxItems,
      scopePolicy: "user-context",
      botId: bot.id,
      allowedScopes: scopes,
      minRelevance: bot.memoryPolicy.minRelevance,
    },
    { consumer: "orchestration", runId: args.runId, tokenBudget: bot.modelConfig.maxContextTokens ?? DEFAULT_CONTEXT_TOKEN_BUDGET },
  );
  return {
    text: result.context.text, scopes,
    retrieved: result.retrievedMemoryIds.length, injected: result.context.injected.length,
    dropped: result.context.droppedMemoryIds.length, estimatedTokens: result.context.estimatedTokens,
  };
}

export interface BotMemoryWrite {
  attempted: boolean;
  scope: BotMemoryScope | null;
  accepted: boolean;
  memoryId: string | null;
  /** Denial by the bot's own policy, distinct from the ingestion gate declining. */
  denied?: string;
  reasons: string[];
}

/**
 * Offer one observation to memory on the bot's behalf. The scope defaults to the
 * bot's first permitted write scope. A scope outside the policy is denied here,
 * before anything reaches the gate. Whatever is stored carries the bot's id, at
 * any scope, so shared memory stays attributable.
 */
export async function writeBotMemory(
  bot: Pick<BotRecord, "id" | "slug" | "memoryPolicy">,
  args: { userId: string; content: string; runId: string; scope?: BotMemoryScope; projectId?: string | null; workspaceId?: string | null; tags?: string[] },
): Promise<BotMemoryWrite> {
  const permitted = memoryWriteScopes(bot.memoryPolicy);
  const scope = args.scope ?? permitted[0] ?? null;
  if (!scope) return { attempted: false, scope: null, accepted: false, memoryId: null, denied: bot.memoryPolicy.enabled ? "The bot's policy allows no write scopes." : "Memory is disabled for this bot.", reasons: [] };
  if (!canWriteMemoryScope(bot.memoryPolicy, scope)) return { attempted: false, scope, accepted: false, memoryId: null, denied: `Write scope "${scope}" is not permitted by this bot's memory policy.`, reasons: [] };
  if (scope === "session") return { attempted: false, scope, accepted: false, memoryId: null, denied: "Session memory is held by the chat room, and a bot task has none.", reasons: [] };
  if (scope === "project" && !args.projectId) return { attempted: false, scope, accepted: false, memoryId: null, denied: "Project scope needs a project, and this task has none.", reasons: [] };
  if (scope === "workspace" && !args.workspaceId) return { attempted: false, scope, accepted: false, memoryId: null, denied: "Workspace scope needs a workspace, and this task has none.", reasons: [] };

  const retentionDays = bot.memoryPolicy.retentionDays;
  let result: RememberResult;
  try {
    result = await remember({
      content: args.content, owner: args.userId, speaker: "agent", source: `bot:${bot.id}`, scope,
      projectId: scope === "project" ? args.projectId : null,
      workspaceId: scope === "workspace" ? args.workspaceId : null,
      botId: bot.id,
      tags: [...new Set([...(args.tags ?? []), `bot:${bot.slug}`, `run:${args.runId}`])],
      validTo: retentionDays ? new Date(Date.now() + retentionDays * 86_400_000) : null,
      skipReconsolidation: bot.memoryPolicy.consolidation === "off",
    });
  } catch (error) {
    return { attempted: true, scope, accepted: false, memoryId: null, denied: error instanceof Error ? error.message : "Memory write failed.", reasons: [] };
  }
  return { attempted: true, scope, accepted: result.accepted, memoryId: result.memoryId, reasons: result.verdict.reasons };
}
