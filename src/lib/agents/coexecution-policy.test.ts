import { describe, expect, it } from "vitest";
import { assertConcurrentDispatchAllowed, wouldSplitAcrossCodingRuntimes } from "./coexecution-policy";

describe("coexecution policy", () => {
  it("blocks concurrent Claude Code and Codex dispatch by default", () => {
    expect(() => assertConcurrentDispatchAllowed(["claude-code", "codex"])).toThrow(/cannot be concurrently dispatched/);
  });

  it("allows an explicit user override", () => {
    expect(() => assertConcurrentDispatchAllowed(["claude-code", "codex"], true)).not.toThrow();
  });

  describe("wouldSplitAcrossCodingRuntimes", () => {
    // This is the shape production actually builds: one already-running agent
    // plus one candidate. The previous implementation could only ever be handed
    // a single-element set, so the pair check was unreachable — these cases
    // pin the reachable form.
    it("blocks Codex while Claude Code is already in flight", () => {
      expect(wouldSplitAcrossCodingRuntimes(["claude-code"], "codex")).toBe(true);
    });

    it("blocks Claude Code while Codex is already in flight", () => {
      expect(wouldSplitAcrossCodingRuntimes(["codex"], "claude-code")).toBe(true);
    });

    it("permits the same coding runtime running more than one task", () => {
      expect(wouldSplitAcrossCodingRuntimes(["claude-code"], "claude-code")).toBe(false);
      expect(wouldSplitAcrossCodingRuntimes(["codex"], "codex")).toBe(false);
    });

    it("permits either coding runtime alongside non-exclusive agents", () => {
      expect(wouldSplitAcrossCodingRuntimes(["hermes-lisa", "openclaw"], "codex")).toBe(false);
      expect(wouldSplitAcrossCodingRuntimes([], "claude-code")).toBe(false);
    });

    it("never constrains agents outside the exclusive pair", () => {
      expect(wouldSplitAcrossCodingRuntimes(["claude-code", "codex"], "hermes-lisa")).toBe(false);
    });

    it("accumulates across a batch so the second claimant is refused", () => {
      // Mirrors partitionConcurrentStarts: the winner is appended to the active
      // set, so the counterpart in the same turn is rejected.
      const active: string[] = [];
      expect(wouldSplitAcrossCodingRuntimes(active, "claude-code")).toBe(false);
      active.push("claude-code");
      expect(wouldSplitAcrossCodingRuntimes(active, "codex")).toBe(true);
    });
  });
});
