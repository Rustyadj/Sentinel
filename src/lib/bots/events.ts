// What a bot run did, as durable events. These are operational facts (a tool was
// requested and allowed, memory was read, a model was used) — never model
// reasoning, which Sentinel does not persist.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { redactPayload } from "@/lib/learning/redaction";

export const BOT_EVENT_TYPES = [
  "queued", "started", "model", "memory_read", "memory_write", "tool_allowed", "tool_denied", "tool_completed",
  "approval_requested", "approval_resolved", "delegated", "usage", "warning", "error", "completed", "cancelled",
] as const;
export type BotEventType = (typeof BOT_EVENT_TYPES)[number];

const MAX_STRING = 400;

function clip(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return depth > 3 ? [] : value.slice(0, 20).map((item) => clip(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 3) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [key, clip(item, depth + 1)]));
  }
  return value;
}

/** Secret-shaped keys are masked and long values clipped before anything is stored. */
export function sanitizeEventData(data: Record<string, unknown>): Prisma.InputJsonValue {
  return clip(redactPayload(data).payload) as Prisma.InputJsonValue;
}

/**
 * Append-only event log for one run. The sequence number is derived from the
 * database on every write, not held in memory, because two processes can write
 * to the same run (the worker executing it, and an API call delegating a child
 * from it); a collision on (runId, seq) is retried.
 */
export class BotRunLog {
  constructor(readonly botId: string, readonly runId: string) {}

  async emit(type: BotEventType, summary: string, data: Record<string, unknown> = {}): Promise<void> {
    const payload = sanitizeEventData(data);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const last = await db.botRunEvent.aggregate({ where: { runId: this.runId }, _max: { seq: true } });
      try {
        await db.botRunEvent.create({ data: { botId: this.botId, runId: this.runId, seq: (last._max.seq ?? 0) + 1, type, summary: summary.slice(0, 300), data: payload } });
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "P2002" || attempt === 5) throw error;
      }
    }
  }
}
