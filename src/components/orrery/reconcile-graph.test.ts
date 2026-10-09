import { describe, expect, it } from "vitest";
import { applyBaseRead, applyFocusRead, composeGraph, dropFocus, edgeKey, emptyStore, graphSignature, type ApiEdge, type ApiNode } from "./reconcile-graph";

const node = (id: string, title = id, type = "Task"): ApiNode => ({ id, title, type });
const edge = (from: string, to: string, extra: Partial<ApiEdge> = {}): ApiEdge => ({ fromObjectId: from, toObjectId: to, type: "related_to", ...extra });
const ids = (g: ReturnType<typeof composeGraph>) => g.nodes.map((n) => n.id).sort();

describe("base reads", () => {
  it("shows a node whose title or type changed with its new values", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a", "Old title", "Task"), node("b")], edges: [] });
    applyBaseRead(store, { nodes: [node("a", "New title", "Decision"), node("b")], edges: [] });
    expect(composeGraph(store).nodes.find((n) => n.id === "a")).toMatchObject({ title: "New title", type: "Decision" });
  });

  it("drops a node and its edges once a complete read no longer returns it", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a"), node("b"), node("c")], edges: [edge("a", "b"), edge("b", "c")] });
    applyBaseRead(store, { nodes: [node("a"), node("c")], edges: [] });
    const g = composeGraph(store);
    expect(ids(g)).toEqual(["a", "c"]);
    expect(g.edges).toEqual([]);
  });

  it("drops an edge that was removed between two nodes that both remain", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a"), node("b")], edges: [edge("a", "b", { id: "e1" })] });
    expect(composeGraph(store).edges).toHaveLength(1);
    applyBaseRead(store, { nodes: [node("a"), node("b")], edges: [] });
    expect(composeGraph(store).edges).toEqual([]);
  });

  it("reflects a changed edge weight", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a"), node("b")], edges: [edge("a", "b", { id: "e1", weight: 0.2 })] });
    const before = graphSignature(composeGraph(store));
    applyBaseRead(store, { nodes: [node("a"), node("b")], edges: [edge("a", "b", { id: "e1", weight: 0.9 })] });
    expect(graphSignature(composeGraph(store))).not.toBe(before);
    expect(composeGraph(store).edges[0].weight).toBe(0.9);
  });

  it("never lets an edge point at a node that is not present", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a")], edges: [edge("a", "ghost")] });
    expect(composeGraph(store).edges).toEqual([]);
  });

  it("an empty complete read empties the globe — an empty graph is a real answer, not an error", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a")], edges: [] });
    applyBaseRead(store, { nodes: [], edges: [] });
    expect(composeGraph(store)).toEqual({ nodes: [], edges: [] });
  });
});

describe("focus reads", () => {
  it("a complete base read supersedes focus reads: what is gone is gone", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a")], edges: [], partial: true });
    applyFocusRead(store, "far", { nodes: [node("far"), node("near")], edges: [edge("far", "near")] });
    expect(ids(composeGraph(store))).toEqual(["a", "far", "near"]);
    applyBaseRead(store, { nodes: [node("a")], edges: [], partial: false });
    expect(ids(composeGraph(store))).toEqual(["a"]);
  });

  it("a partial base read keeps focus reads, because absence from a window proves nothing", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a")], edges: [], partial: true });
    applyFocusRead(store, "far", { nodes: [node("far")], edges: [] });
    applyBaseRead(store, { nodes: [node("a"), node("b")], edges: [], partial: true });
    expect(ids(composeGraph(store))).toEqual(["a", "b", "far"]);
  });

  it("re-checking a focus node replaces its neighbourhood; dropping it removes it", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a")], edges: [], partial: true });
    applyFocusRead(store, "far", { nodes: [node("far"), node("n1")], edges: [edge("far", "n1")] });
    applyFocusRead(store, "far", { nodes: [node("far", "Renamed")], edges: [] });
    const g = composeGraph(store);
    expect(ids(g)).toEqual(["a", "far"]);
    expect(g.nodes.find((n) => n.id === "far")?.title).toBe("Renamed");
    dropFocus(store, "far");
    expect(ids(composeGraph(store))).toEqual(["a"]);
  });

  it("the base read wins when both describe the same node", () => {
    const store = emptyStore();
    applyBaseRead(store, { nodes: [node("a", "From base")], edges: [], partial: true });
    applyFocusRead(store, "x", { nodes: [node("a", "Stale copy"), node("x")], edges: [] });
    expect(composeGraph(store).nodes.find((n) => n.id === "a")?.title).toBe("From base");
  });
});

describe("signature", () => {
  it("is stable across ordering and changes when anything drawn changes", () => {
    const a = { nodes: [node("a"), node("b")], edges: [edge("a", "b")] };
    const reordered = { nodes: [node("b"), node("a")], edges: [edge("a", "b")] };
    expect(graphSignature(a)).toBe(graphSignature(reordered));
    expect(graphSignature(a)).not.toBe(graphSignature({ nodes: [node("a"), node("b", "renamed")], edges: a.edges }));
    expect(graphSignature(a)).not.toBe(graphSignature({ nodes: a.nodes, edges: [] }));
    expect(edgeKey(edge("a", "b"))).toBe("a>b:related_to");
  });
});
