// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, Record<string, unknown>>();
let nextId = 0;

/**
 * A minimal stand-in for the telemetry table.
 *
 * Increments are applied the way Postgres would — as deltas, not as
 * read-modify-write — so a test that interleaves turns exercises the same
 * concurrency shape the real update has.
 */
const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  db: {
    voiceSessionTelemetry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `tel-${++nextId}`;
        store.set(id, {
          id,
          startedAt: new Date(Date.now() - 30_000),
          endedAt: null,
          liveSeconds: 0,
          reasoningInputTokens: 0,
          reasoningOutputTokens: 0,
          toolCallCount: 0,
          latencyMsTotal: 0,
          latencySamples: 0,
          latencyMsMax: 0,
          estimatedCostUsd: null,
          ...data,
        });
        return { id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.get(where.id);
        if (!row) throw new Error("not found");
        for (const [key, value] of Object.entries(data)) {
          if (value === undefined) continue;
          if (value && typeof value === "object" && "increment" in value) {
            row[key] = ((row[key] as number) ?? 0) + (value as { increment: number }).increment;
          } else {
            row[key] = value;
          }
        }
        return row;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.db)),
  },
}));

import {
  finishVoiceSessionTelemetry,
  getVoiceSessionSummary,
  recordReasoningTurn,
  startVoiceSessionTelemetry,
} from "./telemetry";
import { db } from "@/lib/db";
mocks.db = db as unknown as Record<string, unknown>;

async function newSession(reasoningModel = "claude-opus-5") {
  return startVoiceSessionTelemetry({
    userId: "user-1",
    agentId: "hermes-lisa",
    roomId: "room-1",
    voiceModel: "gpt-live-1",
    reasoningModel,
  });
}

describe("voice session telemetry", () => {
  beforeEach(() => {
    store.clear();
    nextId = 0;
  });

  it("accumulates tokens, tool calls and latency across turns", async () => {
    const id = await newSession();
    await recordReasoningTurn({ sessionId: id, latencyMs: 400, inputTokens: 100, outputTokens: 20, toolCalls: 1 });
    await recordReasoningTurn({ sessionId: id, latencyMs: 1200, inputTokens: 50, outputTokens: 10, toolCalls: 2 });

    const summary = (await getVoiceSessionSummary(id))!;
    expect(summary.reasoningInputTokens).toBe(150);
    expect(summary.reasoningOutputTokens).toBe(30);
    expect(summary.toolCallCount).toBe(3);
    expect(summary.averageLatencyMs).toBe(800);
    // The worst turn is kept separately — a mean alone hides the one that
    // made the conversation feel broken.
    expect(summary.maxLatencyMs).toBe(1200);
  });

  it("separates live audio minutes from reasoning tokens", async () => {
    const id = await newSession();
    await recordReasoningTurn({ sessionId: id, latencyMs: 100, inputTokens: 10, outputTokens: 5 });
    await finishVoiceSessionTelemetry(id);

    const summary = (await getVoiceSessionSummary(id))!;
    // Billed by wall-clock on the live layer, independent of token counts.
    expect(summary.liveSeconds).toBeGreaterThanOrEqual(29);
    expect(summary.reasoningInputTokens).toBe(10);
  });

  it("prices a session whose reasoning model has a rate card", async () => {
    const id = await newSession("claude-opus-5");
    await recordReasoningTurn({ sessionId: id, latencyMs: 100, inputTokens: 1_000_000, outputTokens: 0 });
    await finishVoiceSessionTelemetry(id);
    expect((await getVoiceSessionSummary(id))!.estimatedCostUsd).toBeCloseTo(5, 5);
  });

  it("reports unknown rather than zero for an unpriced model", async () => {
    // Lisa's and Nathan2's models have no rate card entry yet. Reporting 0.0
    // would read as "this was free", which is worse than an honest gap.
    const id = await newSession("deepseek/deepseek-v4.1-flash");
    await recordReasoningTurn({ sessionId: id, latencyMs: 100, inputTokens: 5000, outputTokens: 500 });
    await finishVoiceSessionTelemetry(id);
    expect((await getVoiceSessionSummary(id))!.estimatedCostUsd).toBeNull();
  });

  it("ignores a second close so live minutes cannot inflate", async () => {
    const id = await newSession();
    await finishVoiceSessionTelemetry(id);
    const first = (await getVoiceSessionSummary(id))!.liveSeconds;
    await finishVoiceSessionTelemetry(id);
    expect((await getVoiceSessionSummary(id))!.liveSeconds).toBe(first);
  });

  it("does not throw when a turn names a session that no longer exists", async () => {
    await expect(recordReasoningTurn({ sessionId: "gone", latencyMs: 10 })).resolves.toBeUndefined();
  });

  it("has no average latency before any turn", async () => {
    const id = await newSession();
    expect((await getVoiceSessionSummary(id))!.averageLatencyMs).toBeNull();
  });
});
