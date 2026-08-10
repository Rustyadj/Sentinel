import { describe, expect, it } from "vitest";
import { densityRank, groupColor } from "@/components/neural-lens/palette";

describe("palette — groupColor (deterministic workspace/hub focus color)", () => {
  it("is deterministic for the same key", () => {
    expect(groupColor("workspace-a")).toBe(groupColor("workspace-a"));
  });

  it("returns a color for undefined/empty keys (DEMO mode, no workspace)", () => {
    expect(groupColor(undefined)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("assigns different workspaces different colors often enough to be distinguishable", () => {
    const colors = new Set(
      ["ws-1", "ws-2", "ws-3", "ws-4", "ws-5"].map((id) => groupColor(id)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("palette — densityRank (visual-density thinning)", () => {
  it("is deterministic, so lowering density always removes the same dots", () => {
    expect(densityRank("node-42")).toBe(densityRank("node-42"));
  });

  it("stays within 0..1 so it can be compared against the density setting", () => {
    for (const id of ["a", "node-1", "Cybersecurity-hub-0-c17", "x".repeat(64)]) {
      const rank = densityRank(id);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThan(1);
    }
  });

  // The contract the density slider depends on: keeping the lowest-ranked 70%
  // of nodes has to draw about 70% of them, including for the near-identical
  // sequential ids a generated graph is full of.
  it.each([0.3, 0.5, 0.72, 0.9])("keeps about %s of a sequential id run", (density) => {
    const ids = Array.from({ length: 4000 }, (_, i) => `Cybersecurity-hub-2-c${i}`);
    const kept = ids.filter((id) => densityRank(id) <= density).length / ids.length;
    expect(kept).toBeGreaterThan(density - 0.04);
    expect(kept).toBeLessThan(density + 0.04);
  });
});
