import { describe, expect, it } from "vitest";
import { generateDemoGraph } from "@/components/neural-lens/demoGraph";
import { CLUSTER_IDS, CORE_CLUSTER_ID } from "@/components/neural-lens/categories";

describe("demoGraph — deterministic dense radial generator", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateDemoGraph({ seed: 42 });
    const b = generateDemoGraph({ seed: 42 });
    expect(a.meta.nodeCount).toBe(b.meta.nodeCount);
    expect(a.meta.edgeCount).toBe(b.meta.edgeCount);
    expect(a.nodes[100]?.id).toBe(b.nodes[100]?.id);
    expect(a.nodes[100]?.x).toBe(b.nodes[100]?.x);
  });

  it("hits the requested node target exactly, with far more edges than nodes", () => {
    const g = generateDemoGraph({ targetNodes: 880 });
    expect(g.meta.nodeCount).toBe(880);
    // Hub-and-spoke + bridges ⇒ comfortably more edges than nodes.
    expect(g.meta.edgeCount).toBeGreaterThan(g.meta.nodeCount);
  });

  it("matches the default Neural Lens working-set density", () => {
    const g = generateDemoGraph();
    expect(g.meta.nodeCount).toBe(24000);
    expect(g.meta.edgeCount).toBe(150000);
  });

  it("lays every node out on the globe, inside the shell", () => {
    const g = generateDemoGraph({ targetNodes: 1200 });
    for (const node of g.nodes) {
      const r = Math.hypot(node.x, node.y, node.z);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeLessThanOrEqual(1000 + 1e-6);
    }
    // The core region reaches the centre; the shell reaches the surface.
    const maxRadius = Math.max(...g.nodes.map((n) => Math.hypot(n.x, n.y, n.z)));
    expect(maxRadius).toBeGreaterThan(900);
  });

  it("reports one region per cluster so the globe can label them", () => {
    const g = generateDemoGraph({ targetNodes: 1200 });
    expect(g.regions).toBeDefined();
    expect(g.regions!.length).toBe(CLUSTER_IDS.length);
    expect(g.regions!.filter((r) => r.core)).toHaveLength(1);
  });

  it("connects the core region to every other region, so the graph reads as one planet", () => {
    const g = generateDemoGraph({ targetNodes: 1200 });
    const coreHub = `${CORE_CLUSTER_ID}-hub-0`;
    const linkedClusters = new Set<string>();
    const clusterById = new Map(g.nodes.map((n) => [n.id, n.clusterId]));
    for (const link of g.links) {
      if (link.source === coreHub) linkedClusters.add(clusterById.get(link.target)!);
      else if (link.target === coreHub) linkedClusters.add(clusterById.get(link.source)!);
    }
    for (const cluster of CLUSTER_IDS) expect(linkedClusters.has(cluster)).toBe(true);
  });

  it("has a small set of large hubs and a majority of small leaf nodes", () => {
    const g = generateDemoGraph();
    const hubs = g.nodes.filter((n) => n.val >= 6);
    expect(hubs.length).toBeGreaterThanOrEqual(4);
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
    // Collected rather than asserted per link: at ~150k edges, one expect()
    // per endpoint is slower than the graph is worth testing.
    const selfLinks = g.links.filter((l) => l.source === l.target);
    const dangling = g.links.filter((l) => !ids.has(l.source) || !ids.has(l.target));
    expect(selfLinks).toHaveLength(0);
    expect(dangling).toHaveLength(0);
  });

  it("marks the graph as demo data", () => {
    expect(generateDemoGraph().meta.demo).toBe(true);
  });
});
