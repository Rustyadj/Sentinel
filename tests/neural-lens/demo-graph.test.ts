import { describe, expect, it } from "vitest";
import { generateDemoGraph } from "@/components/neural-lens/demoGraph";

describe("demoGraph — deterministic dense radial generator", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateDemoGraph({ seed: 42 });
    const b = generateDemoGraph({ seed: 42 });
    expect(a.meta.nodeCount).toBe(b.meta.nodeCount);
    expect(a.meta.edgeCount).toBe(b.meta.edgeCount);
    expect(a.nodes[100]?.id).toBe(b.nodes[100]?.id);
    expect(a.nodes[100]?.x).toBe(b.nodes[100]?.x);
  });

  it("produces a dense graph near the requested node target with more edges than nodes", () => {
    const g = generateDemoGraph({ targetNodes: 880 });
    expect(g.meta.nodeCount).toBeGreaterThan(700);
    expect(g.meta.nodeCount).toBeLessThanOrEqual(880);
    // Hub-and-spoke + bridges ⇒ comfortably more edges than nodes.
    expect(g.meta.edgeCount).toBeGreaterThan(g.meta.nodeCount);
  });

  it("has a small set of large hubs and a majority of small leaf nodes", () => {
    const g = generateDemoGraph();
    const hubs = g.nodes.filter((n) => n.val >= 6);
    expect(hubs.length).toBeGreaterThanOrEqual(5);
    expect(hubs.length).toBeLessThan(20);
    expect(hubs.length).toBeLessThan(g.nodes.length / 10);
  });

  it("keeps most nodes neutral (accent nodes are a minority)", () => {
    const g = generateDemoGraph();
    const accents = g.nodes.filter((n) => n.accent).length;
    expect(accents).toBeLessThan(g.nodes.length / 2);
  });

  it("never emits self-links or links to missing nodes", () => {
    const g = generateDemoGraph();
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const l of g.links) {
      expect(l.source).not.toBe(l.target);
      expect(ids.has(l.source)).toBe(true);
      expect(ids.has(l.target)).toBe(true);
    }
  });

  it("marks the graph as demo data", () => {
    expect(generateDemoGraph().meta.demo).toBe(true);
  });
});
