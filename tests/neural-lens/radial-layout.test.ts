import { describe, expect, it } from "vitest";
import {
  computeRadialLayout,
  rotatePositions,
  type LayoutInputNode,
} from "@/components/neural-lens/radialLayout";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";

describe("radialLayout — computeRadialLayout (pure geometry)", () => {
  it("places a single hub at the origin", () => {
    const nodes: LayoutInputNode[] = [{ id: "h", hubId: "h", parentId: "h", tier: 0 }];
    const pos = computeRadialLayout(nodes);
    expect(pos.get("h")).toEqual({ id: "h", x: 0, y: 0 });
  });

  it("is deterministic across runs", () => {
    const nodes: LayoutInputNode[] = [
      { id: "h1", hubId: "h1", parentId: "h1", tier: 0 },
      { id: "h2", hubId: "h2", parentId: "h2", tier: 0 },
      { id: "c1", hubId: "h1", parentId: "h1", tier: 1 },
    ];
    const a = computeRadialLayout(nodes);
    const b = computeRadialLayout(nodes);
    expect(a.get("c1")).toEqual(b.get("c1"));
  });

  it("positions children within the child radius of their hub", () => {
    const nodes: LayoutInputNode[] = [
      { id: "h1", hubId: "h1", parentId: "h1", tier: 0 },
      { id: "h2", hubId: "h2", parentId: "h2", tier: 0 },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        hubId: "h1",
        parentId: "h1",
        tier: 1 as const,
      })),
    ];
    const pos = computeRadialLayout(nodes, { childRadius: 300 });
    const hub = pos.get("h1")!;
    for (let i = 0; i < 8; i++) {
      const c = pos.get(`c${i}`)!;
      const dist = Math.hypot(c.x - hub.x, c.y - hub.y);
      // childRadius jitter is 0.7..1.3 of base ⇒ within [210, 390].
      expect(dist).toBeGreaterThan(150);
      expect(dist).toBeLessThan(430);
    }
  });

  it("rotatePositions rotates a point about the origin by the given angle", () => {
    const pts = [{ x: 10, y: 0 }];
    rotatePositions(pts, Math.PI / 2);
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(10, 5);
  });
});

describe("fromApiGraph — buildLensGraphFromApi", () => {
  it("treats hub-typed nodes as hubs and attaches the rest as children", () => {
    const g = buildLensGraphFromApi({
      nodes: [
        { id: "p1", type: "Project", title: "Proj" },
        { id: "n1", type: "Note", title: "Note 1" },
        { id: "n2", type: "Note", title: "Note 2" },
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
    expect(ids).toContain("__orphans__");
    expect(g.links.some((l) => l.target === "loose")).toBe(true);
  });

  it("marks the result as non-demo (SCOPED) data", () => {
    const g = buildLensGraphFromApi({ nodes: [], edges: [] });
    expect(g.meta.demo).toBe(false);
  });
});
