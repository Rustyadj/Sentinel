// Neural Lens — radial hub-and-spoke layout (Phase D, pure).
//
// Produces the "dandelion constellation" geometry of the reference: a handful
// of hubs arranged in a loose ring near the center, each fanning its children
// out along an arc, with a second tier of grandchildren fanning around those.
// Positions are deterministic given the input, so the layout is stable across
// renders and unit-testable without a canvas.

export interface LayoutInputNode {
  id: string;
  hubId: string;
  /** Parent within the hub's tree (a hub node's parent is itself). */
  parentId: string;
  /** Tree tier: 0 = hub, 1 = child, 2 = grandchild. */
  tier: number;
}

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export interface RadialLayoutOptions {
  hubRingRadius?: number;
  childRadius?: number;
  grandchildRadius?: number;
}

/**
 * Lay out nodes radially. Hubs are spread evenly around a ring; each hub's
 * children fan across a wedge pointing outward from center; grandchildren fan
 * in a smaller arc around their parent child. Jitter is hash-derived so it is
 * deterministic but organic.
 */
export function computeRadialLayout(
  nodes: LayoutInputNode[],
  options: RadialLayoutOptions = {},
): Map<string, Positioned> {
  const hubRingRadius = options.hubRingRadius ?? 520;
  const childRadius = options.childRadius ?? 300;
  const grandchildRadius = options.grandchildRadius ?? 120;

  const positions = new Map<string, Positioned>();

  const hubs = nodes.filter((n) => n.tier === 0);
  const hubAngle = new Map<string, number>();

  // Hubs around a ring. A single hub sits at the origin.
  hubs.forEach((hub, i) => {
    if (hubs.length === 1) {
      positions.set(hub.id, { id: hub.id, x: 0, y: 0 });
      hubAngle.set(hub.id, 0);
      return;
    }
    const angle = (i / hubs.length) * Math.PI * 2;
    hubAngle.set(hub.id, angle);
    const jitter = 0.82 + hash(hub.id) * 0.36;
    positions.set(hub.id, {
      id: hub.id,
      x: Math.cos(angle) * hubRingRadius * jitter,
      y: Math.sin(angle) * hubRingRadius * jitter,
    });
  });

  // Children fan across a wedge that points away from center.
  const childrenByHub = new Map<string, LayoutInputNode[]>();
  for (const n of nodes) {
    if (n.tier === 1) {
      if (!childrenByHub.has(n.hubId)) childrenByHub.set(n.hubId, []);
      childrenByHub.get(n.hubId)!.push(n);
    }
  }

  const childAngle = new Map<string, number>();
  for (const [hubId, children] of childrenByHub) {
    const hubPos = positions.get(hubId);
    if (!hubPos) continue;
    const outward = hubs.length === 1 ? hash(hubId) * Math.PI * 2 : hubAngle.get(hubId) ?? 0;
    const wedge = Math.PI * 1.5; // 270° spray
    children.forEach((child, i) => {
      const t = children.length === 1 ? 0.5 : i / (children.length - 1);
      const angle = outward - wedge / 2 + t * wedge + (hash(child.id) - 0.5) * 0.22;
      const r = childRadius * (0.7 + hash(`${child.id}:r`) * 0.6);
      childAngle.set(child.id, angle);
      positions.set(child.id, {
        id: child.id,
        x: hubPos.x + Math.cos(angle) * r,
        y: hubPos.y + Math.sin(angle) * r,
      });
    });
  }

  // Grandchildren fan in a small arc around their parent child, continuing outward.
  for (const n of nodes) {
    if (n.tier !== 2) continue;
    const parentPos = positions.get(n.parentId);
    if (!parentPos) continue;
    const base = childAngle.get(n.parentId) ?? hash(n.parentId) * Math.PI * 2;
    const angle = base + (hash(n.id) - 0.5) * 1.1;
    const r = grandchildRadius * (0.6 + hash(`${n.id}:g`) * 0.8);
    positions.set(n.id, {
      id: n.id,
      x: parentPos.x + Math.cos(angle) * r,
      y: parentPos.y + Math.sin(angle) * r,
    });
  }

  return positions;
}

/** Rotate all positions around the origin by `radians` (used for slow drift). */
export function rotatePositions(
  positions: Array<{ x: number; y: number }>,
  radians: number,
): void {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (const p of positions) {
    const x = p.x * cos - p.y * sin;
    const y = p.x * sin + p.y * cos;
    p.x = x;
    p.y = y;
  }
}
