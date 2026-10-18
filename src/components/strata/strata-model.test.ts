import { describe, expect, it } from "vitest";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";
import { toGlobeModel } from "@/components/orrery/globe-model";
import { STRATA, stratumOf, toStrataModel } from "./strata-model";

const nodes = [
  { id: "agent-1", type: "Agent", title: "Lisa" },
  { id: "proj-1", type: "Project", title: "Release" },
  { id: "task-1", type: "Task", title: "Ship it" },
  { id: "mem-1", type: "Memory", title: "OAuth decision" },
  { id: "odd-1", type: "SomethingNew", title: "Unmapped" },
];
const edges = [
  { id: "e1", fromObjectId: "agent-1", toObjectId: "proj-1", weight: 0.8 },
  { id: "e2", fromObjectId: "proj-1", toObjectId: "task-1", weight: 0.5 },
  { id: "e3", fromObjectId: "task-1", toObjectId: "mem-1", weight: 0.3 },
];

const build = () => toStrataModel(toGlobeModel(buildLensGraphFromApi({ nodes, edges })));

describe("strata model", () => {
  it("has four strata in top-down order", () => {
    expect(STRATA.map((s) => s.id)).toEqual(["agents", "projects", "tasks", "memory"]);
  });

  it("places each type on its stratum and unknown types in memory", () => {
    expect(stratumOf("Agent")).toBe(0);
    expect(stratumOf("Project")).toBe(1);
    expect(stratumOf("Task")).toBe(2);
    expect(stratumOf("Memory")).toBe(3);
    expect(stratumOf("SomethingNew")).toBe(3);
  });

  it("counts exactly the supplied nodes per stratum", () => {
    const model = build();
    expect(model.nodeCount).toBe(nodes.length);
    expect(model.counts).toEqual([1, 1, 1, 2]);
  });

  it("is deterministic: the same graph always lands in the same place", () => {
    const a = build(), b = build();
    expect(Array.from(a.u)).toEqual(Array.from(b.u));
    expect(Array.from(a.v)).toEqual(Array.from(b.v));
  });

  it("keeps every node on its plane", () => {
    const model = build();
    for (let i = 0; i < model.nodeCount; i++) expect(Math.hypot(model.u[i], model.v[i])).toBeLessThanOrEqual(0.93);
  });

  it("draws a lower node toward what it hangs from", () => {
    const model = build();
    const at = (id: string) => model.indexById.get(id)!;
    const d = (a: number, b: number) => Math.hypot(model.u[a] - model.u[b], model.v[a] - model.v[b]);
    // proj-1 leans toward agent-1: closer than a fully independent seat would typically be.
    expect(d(at("proj-1"), at("agent-1"))).toBeLessThan(0.9);
  });

  it("is empty for an empty graph", () => {
    const empty = toStrataModel(toGlobeModel(buildLensGraphFromApi({ nodes: [], edges: [] })));
    expect(empty.nodeCount).toBe(0);
    expect(empty.counts).toEqual([0, 0, 0, 0]);
  });
});
