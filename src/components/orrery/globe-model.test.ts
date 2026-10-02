import { describe, expect, it } from "vitest";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";
import { toGlobeModel } from "./globe-model";

const nodes = [
  { id: "agent-1", type: "Agent", title: "Lisa" },
  { id: "task-1", type: "Task", title: "Ship it" },
  { id: "mem-1", type: "Memory", title: "OAuth decision" },
  { id: "room-1", type: "Conversation", title: "#ops" },
];
const edges = [
  { id: "e1", fromObjectId: "agent-1", toObjectId: "task-1", weight: 0.8, type: "created_by" },
  { id: "e2", fromObjectId: "task-1", toObjectId: "mem-1", weight: 0.3 },
  { id: "dangling", fromObjectId: "task-1", toObjectId: "missing", weight: 1 },
];

describe("toGlobeModel", () => {
  const model = toGlobeModel(buildLensGraphFromApi({ nodes, edges }));

  it("contains exactly the supplied nodes, indexed by id", () => {
    expect(model.ids).toEqual(expect.arrayContaining(nodes.map((n) => n.id)));
    for (const n of nodes) expect(model.labels[model.indexById.get(n.id)!]).toBe(n.title);
  });

  it("drops edges whose endpoint is not in the graph", () => {
    expect(model.edgeCount).toBe(2);
    expect(model.adjacency[model.indexById.get("task-1")!]).toHaveLength(2);
  });

  it("never draws layout scaffolding as if it were data", () => {
    const loose = toGlobeModel(buildLensGraphFromApi({ nodes: [{ id: "n1", type: "Memory", title: "Loose note" }], edges: [] }));
    expect(loose.ids).toEqual(["n1"]);
    expect(loose.edgeCount).toBe(0);
    expect(loose.regions.find((r) => r.id === "Memory")?.nodeCount).toBe(1);
  });

  it("keeps every node inside the unit sphere", () => {
    for (let i = 0; i < model.nodeCount; i++) {
      expect(Math.hypot(model.x[i], model.y[i], model.z[i])).toBeLessThanOrEqual(1.01);
    }
  });

  it("only reports regions that hold nodes as populated", () => {
    const populated = model.regions.filter((r) => r.nodeCount > 0).map((r) => r.id);
    expect(populated).toEqual(expect.arrayContaining(["Organization", "Projects", "Memory", "Chat"]));
    expect(populated).not.toContain("Marketing");
  });

  it("is empty for an empty graph", () => {
    const empty = toGlobeModel(buildLensGraphFromApi({ nodes: [], edges: [] }));
    expect(empty.nodeCount).toBe(0);
    expect(empty.edgeCount).toBe(0);
  });
});
