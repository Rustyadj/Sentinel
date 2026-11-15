import { describe, expect, it } from "vitest";
import { toGlobeModel } from "@/components/orrery/globe-model";
import { toStrataModel } from "@/components/strata/strata-model";
import { layoutWatch, LIGHT_RADIUS, RING_RADIUS } from "./watch-model";

type GlobeInput = Parameters<typeof toGlobeModel>[0];

function graph(nodes: Array<[string, string]>, edges: Array<[string, string]>) {
  const input = {
    nodes: nodes.map(([id, type]) => ({ id, label: id, type })),
    links: edges.map(([source, target]) => ({ source, target })),
  } as unknown as GlobeInput;
  return toStrataModel(toGlobeModel(input));
}

const at = (layout: ReturnType<typeof layoutWatch>, model: ReturnType<typeof graph>, id: string) => {
  const i = model.indexById.get(id)!;
  return { r: Math.hypot(layout.x[i], layout.y[i]), a: Math.atan2(layout.y[i], layout.x[i]) };
};
const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe("the watch layout", () => {
  const model = graph(
    [["lisa", "Agent"], ["codex", "Agent"], ["sentinel", "Project"], ["ship", "Task"], ["lesson", "Memory"], ["orphan", "Note"]],
    [["lisa", "sentinel"], ["sentinel", "ship"], ["ship", "lesson"]],
  );

  it("stands each agent's own node at its light, and rings everything else by kind", () => {
    const layout = layoutWatch(model, ["lisa", "codex"]);
    expect(at(layout, model, "lisa").r).toBeCloseTo(LIGHT_RADIUS, 5);
    expect(at(layout, model, "codex").r).toBeCloseTo(LIGHT_RADIUS, 5);
    expect(layout.lightNode[0]).toBe(model.indexById.get("lisa"));
    expect(Math.abs(at(layout, model, "sentinel").r - RING_RADIUS[1])).toBeLessThan(0.08);
    expect(Math.abs(at(layout, model, "ship").r - RING_RADIUS[2])).toBeLessThan(0.08);
    expect(Math.abs(at(layout, model, "lesson").r - RING_RADIUS[3])).toBeLessThan(0.08);
  });

  it("leans a node toward what it is connected to nearer the centre", () => {
    const layout = layoutWatch(model, ["lisa", "codex"]);
    const lisa = at(layout, model, "lisa").a;
    expect(apart(at(layout, model, "sentinel").a, lisa)).toBeLessThan(0.4);
    expect(apart(at(layout, model, "ship").a, at(layout, model, "sentinel").a)).toBeLessThan(0.4);
  });

  it("is the same picture every time", () => {
    const a = layoutWatch(model, ["lisa", "codex"]);
    const b = layoutWatch(model, ["lisa", "codex"]);
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
  });

  it("gives an agent with no node in the graph a light and binds nothing to it", () => {
    const layout = layoutWatch(model, ["lisa", null, "not-in-graph"]);
    expect([...layout.lightNode]).toEqual([model.indexById.get("lisa"), -1, -1]);
    expect(Math.hypot(layout.lightX[1], layout.lightY[1])).toBeCloseTo(LIGHT_RADIUS, 5);
    // The unbound agent node falls back to the inner ring with the rest of its kind.
    expect(Math.abs(at(layout, model, "codex").r - RING_RADIUS[0])).toBeLessThan(0.05);
  });

  it("does not stack nodes that lean the same way", () => {
    const crowded = graph(
      [["lisa", "Agent"], ...Array.from({ length: 12 }, (_, i) => [`t${i}`, "Project"] as [string, string])],
      Array.from({ length: 12 }, (_, i) => ["lisa", `t${i}`] as [string, string]),
    );
    const layout = layoutWatch(crowded, ["lisa"]);
    const angles = Array.from({ length: 12 }, (_, i) => at(layout, crowded, `t${i}`).a).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeGreaterThan(0.1);
  });
});
