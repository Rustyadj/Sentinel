import { describe, expect, it } from "vitest";
import { groupColor, hexToRgba } from "@/components/neural-lens/palette";

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

describe("palette — hexToRgba", () => {
  it("converts a hex color to an rgba string with the given alpha", () => {
    expect(hexToRgba("#7dd3fc", 0.6)).toBe("rgba(125, 211, 252, 0.6)");
  });
});
