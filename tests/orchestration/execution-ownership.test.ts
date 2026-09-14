import { describe, expect, it } from "vitest";
import { acquireExecutionOwnership, releaseExecutionOwnership, renewExecutionOwnership } from "@/lib/orchestration/execution-ownership";

describe("durable execution ownership", () => {
  it("permits exactly one worker lease and only its owner may renew or release it", async () => {
    const runId = `ownership-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      expect(await acquireExecutionOwnership(runId, "worker-a")).toBe(true);
      expect(await acquireExecutionOwnership(runId, "worker-b")).toBe(false);
      expect(await renewExecutionOwnership(runId, "worker-b")).toBe(false);
      await releaseExecutionOwnership(runId, "worker-b");
      expect(await acquireExecutionOwnership(runId, "worker-b")).toBe(false);
      expect(await renewExecutionOwnership(runId, "worker-a")).toBe(true);
    } finally {
      await releaseExecutionOwnership(runId, "worker-a");
    }
  });

  it("allows a replacement owner after lease handoff while the stale owner cannot renew", async () => {
    const runId = `handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      expect(await acquireExecutionOwnership(runId, "stale-worker")).toBe(true);
      await releaseExecutionOwnership(runId, "stale-worker");
      expect(await acquireExecutionOwnership(runId, "replacement-worker")).toBe(true);
      expect(await renewExecutionOwnership(runId, "stale-worker")).toBe(false);
    } finally {
      await releaseExecutionOwnership(runId, "replacement-worker");
    }
  });
});
