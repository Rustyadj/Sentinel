import { describe, expect, it } from "vitest";
import {
  computeGlobeLayout,
  type GlobeLayoutInputNode,
} from "@/components/neural-lens/globeLayout";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";

const RADIUS = 1000;

/** Two shell clusters with a hub + children each, plus a core cluster. */
function sampleNodes(): GlobeLayoutInputNode[] {
  return [
    { id: "a-hub", clusterId: "A", hubId: "a-hub", parentId: "a-hub", tier: 0 },
    { id: "b-hub", clusterId: "B", hubId: "b-hub", parentId: "b-hub", tier: 0 },
    { id: "core-hub", clusterId: "CORE", hubId: "core-hub", parentId: "core-hub", tier: 0 },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `a-c${i}`,
      clusterId: "A",
      hubId: "a-hub",
      parentId: "a-hub",
      tier: 1 as const,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `a-g${i}`,
      clusterId: "A",
      hubId: "a-hub",
      parentId: `a-c${i}`,
      tier: 2 as const,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `core-c${i}`,
      clusterId: "CORE",
      hubId: "core-hub",
      parentId: "core-hub",
      tier: 1 as const,
    })),
  ];
}

describe("globeLayout — computeGlobeLayout (pure geometry)", () => {
  it("places every shell node inside the globe and near its surface", () => {
    const { positions } = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], {
      radius: RADIUS,
      coreClusterId: "CORE",
    });
    for (const id of ["a-hub", "b-hub", "a-c0", "a-g0"]) {
      const p = positions.get(id)!;
      const r = Math.hypot(p.x, p.y, p.z);
      // shellDepth defaults to 0.3 ⇒ the shell occupies [0.7R, R].
      expect(r).toBeLessThanOrEqual(RADIUS + 1e-6);
      expect(r).toBeGreaterThanOrEqual(RADIUS * 0.7 - 1e-6);
    }
  });

  it("seats the core cluster's primary hub at the exact centre", () => {
    const { positions } = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], {
      radius: RADIUS,
      coreClusterId: "CORE",
    });
    expect(positions.get("core-hub")).toEqual({ id: "core-hub", x: 0, y: 0, z: 0 });
  });

  it("keeps the core cluster's members inside the core ball", () => {
    const { positions } = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], {
      radius: RADIUS,
      coreClusterId: "CORE",
      coreScale: 0.2,
    });
    for (let i = 0; i < 8; i++) {
      const p = positions.get(`core-c${i}`)!;
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThanOrEqual(RADIUS * 0.2 + 1e-6);
    }
  });

  it("is deterministic — the same input lands in the same place", () => {
    const a = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], { coreClusterId: "CORE" });
    const b = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], { coreClusterId: "CORE" });
    expect(a.positions.get("a-c5")).toEqual(b.positions.get("a-c5"));
    expect(a.regions).toEqual(b.regions);
  });

  it("does not depend on the order nodes arrive in", () => {
    const forward = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], { coreClusterId: "CORE" });
    const shuffled = computeGlobeLayout([...sampleNodes()].reverse(), ["A", "B", "CORE"], {
      coreClusterId: "CORE",
    });
    expect(shuffled.positions.get("a-c5")).toEqual(forward.positions.get("a-c5"));
  });

  it("holds a cluster's region fixed when other clusters change size", () => {
    const base = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], { coreClusterId: "CORE" });
    const grown = computeGlobeLayout(
      [
        ...sampleNodes(),
        ...Array.from({ length: 40 }, (_, i) => ({
          id: `b-c${i}`,
          clusterId: "B",
          hubId: "b-hub",
          parentId: "b-hub",
          tier: 1 as const,
        })),
      ],
      ["A", "B", "CORE"],
      { coreClusterId: "CORE" },
    );
    expect(grown.positions.get("a-c5")).toEqual(base.positions.get("a-c5"));
  });

  it("keeps a region's centre of mass on its own anchor, while letting a minority wander", () => {
    // Most members sit in their region's cap; a deliberate minority reaches
    // well past it so the globe carries an even haze instead of tiling into
    // visible bands. So the invariant is about the bulk, not every node.
    const { positions, regions } = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], {
      radius: RADIUS,
      coreClusterId: "CORE",
    });
    const regionA = regions.find((r) => r.clusterId === "A")!;
    const regionB = regions.find((r) => r.clusterId === "B")!;
    const distanceTo = (id: string, region: typeof regionA) => {
      const p = positions.get(id)!;
      return Math.hypot(p.x - region.x, p.y - region.y, p.z - region.z);
    };

    const ids = Array.from({ length: 12 }, (_, i) => `a-c${i}`);
    const nearOwnAnchor = ids.filter((id) => distanceTo(id, regionA) < distanceTo(id, regionB));
    expect(nearOwnAnchor.length / ids.length).toBeGreaterThanOrEqual(0.7);

    const centre = ids.reduce(
      (acc, id) => {
        const p = positions.get(id)!;
        return { x: acc.x + p.x / ids.length, y: acc.y + p.y / ids.length, z: acc.z + p.z / ids.length };
      },
      { x: 0, y: 0, z: 0 },
    );
    const toA = Math.hypot(centre.x - regionA.x, centre.y - regionA.y, centre.z - regionA.z);
    const toB = Math.hypot(centre.x - regionB.x, centre.y - regionB.y, centre.z - regionB.z);
    expect(toA).toBeLessThan(toB);
  });

  it("reports one region per cluster, with the core flagged and a bounding radius that covers its members", () => {
    const { positions, regions } = computeGlobeLayout(sampleNodes(), ["A", "B", "CORE"], {
      radius: RADIUS,
      coreClusterId: "CORE",
    });
    expect(regions.map((r) => r.clusterId).sort()).toEqual(["A", "B", "CORE"]);
    expect(regions.find((r) => r.clusterId === "CORE")!.core).toBe(true);
    expect(regions.find((r) => r.clusterId === "A")!.core).toBe(false);

    const regionA = regions.find((r) => r.clusterId === "A")!;
    for (let i = 0; i < 12; i++) {
      const p = positions.get(`a-c${i}`)!;
      const distance = Math.hypot(p.x - regionA.x, p.y - regionA.y, p.z - regionA.z);
      expect(distance).toBeLessThanOrEqual(regionA.radius + 1e-6);
    }
    expect(regionA.nodeCount).toBe(19);
  });

  it("appends clusters missing from the declared order instead of dropping them", () => {
    const { positions, regions } = computeGlobeLayout(sampleNodes(), ["A"], { coreClusterId: "CORE" });
    expect(regions.map((r) => r.clusterId)).toContain("B");
    expect(positions.get("b-hub")).toBeDefined();
  });
});

describe("fromApiGraph — buildLensGraphFromApi", () => {
  it("treats hub-typed nodes as hubs and attaches the rest as children", () => {
    const g = buildLensGraphFromApi({
      nodes: [
        { id: "p1", type: "Project", title: "Proj" },
        { id: "n1", type: "Task", title: "Task 1" },
        { id: "n2", type: "Task", title: "Task 2" },
      ],
      edges: [
        { fromObjectId: "p1", toObjectId: "n1" },
        { fromObjectId: "p1", toObjectId: "n2" },
      ],
    });
    const hub = g.nodes.find((n) => n.id === "p1")!;
    expect(hub.val).toBeGreaterThanOrEqual(6);
    expect(g.nodes).toHaveLength(3);
    expect(g.links.length).toBeGreaterThanOrEqual(2);
  });

  it("threads workspaceId through onto the LensNode, for the focus/neighborhood-color pipeline", () => {
    const g = buildLensGraphFromApi({
      nodes: [
        { id: "p1", type: "Project", title: "Proj", workspaceId: "ws-1" },
        { id: "n1", type: "Note", title: "Note 1", workspaceId: "ws-1" },
        { id: "n2", type: "Note", title: "Note 2", workspaceId: null },
      ],
      edges: [
        { fromObjectId: "p1", toObjectId: "n1" },
        { fromObjectId: "p1", toObjectId: "n2" },
      ],
    });
    expect(g.nodes.find((n) => n.id === "p1")?.workspaceId).toBe("ws-1");
    expect(g.nodes.find((n) => n.id === "n1")?.workspaceId).toBe("ws-1");
    expect(g.nodes.find((n) => n.id === "n2")?.workspaceId).toBeUndefined();
  });

  it("routes nodes with no hub edge into a synthetic orphans hub instead of dropping them", () => {
    const g = buildLensGraphFromApi({
      nodes: [
        { id: "p1", type: "Project", title: "Proj" },
        { id: "loose", type: "Note", title: "Floating note" },
      ],
      edges: [],
    });
    // loose has no edge to the hub ⇒ orphan hub is synthesized and it attaches.
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain("loose");
    const orphanId = ids.find((id) => id.startsWith("__orphans__:"));
    expect(orphanId).toBeDefined();
    expect(g.links.some((l) => l.source === orphanId && l.target === "loose")).toBe(true);
  });

  it("marks the result as non-demo (SCOPED) data", () => {
    const g = buildLensGraphFromApi({ nodes: [], edges: [] });
    expect(g.meta.demo).toBe(false);
  });
});
