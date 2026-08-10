// Neural Lens — spherical (globe) layout.
//
// Places the one canonical Sentinel graph on a sphere: each OS-level cluster
// claims a stable cap of the shell, one designated cluster forms the dense
// core at the centre, and every node's coordinate is a pure function of its
// id. Nothing here reads a canvas, a clock, or Math.random — the same graph
// always lands in the same place, which is what makes lens switching
// (emphasis only, never re-layout) and "spatial memory" possible at all.
//
// Geometry, in one paragraph: cluster anchors are spread over the sphere by
// the golden-angle spiral, so regions stay evenly distributed and a cluster
// keeps its slice of the globe no matter how lopsided the data is. Within a
// cluster, each hub owns a sub-cap of that anchor's cap, its children fan
// inside the sub-cap, and grandchildren cling to their parent. Depth comes
// from the radius: most nodes sit near the surface, a minority sit deeper in
// the shell, which is what reads as volume rather than a painted ball.

export interface GlobeLayoutInputNode {
  id: string;
  clusterId: string;
  /** Cluster-local hub this node hangs from (a hub's hubId is itself). */
  hubId: string;
  /** Parent within the hub's tree (a hub's parent is itself). */
  parentId: string;
  /** Tree tier: 0 = hub, 1 = child, 2 = grandchild. */
  tier: number;
}

export interface GlobePosition {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** A cluster's footprint on the globe — what region labels pin to, what the
 * minimap outlines, and what "square up on this region" aims the camera at. */
export interface GlobeRegion {
  clusterId: string;
  /** Anchor point in world space (on the shell, or the origin for the core). */
  x: number;
  y: number;
  z: number;
  /** Outward unit normal at the anchor — lets an overlay hide a label once
   * its region rotates to the far side of the globe. */
  nx: number;
  ny: number;
  nz: number;
  /** World-space radius covering every member, measured from the anchor. */
  radius: number;
  nodeCount: number;
  /** True for the cluster placed as the dense core at the centre. */
  core: boolean;
}

export interface GlobeLayoutOptions {
  /** Shell radius — the globe's outer surface. */
  radius?: number;
  /** How far inward from the surface the shell reaches, as a fraction of
   * `radius`. Higher = thicker, more volumetric field. */
  shellDepth?: number;
  /** Cluster to place as the dense core at the centre instead of on the
   * shell. Its first hub lands exactly at the origin. */
  coreClusterId?: string;
  /** Radius of the core ball, as a fraction of `radius`. */
  coreScale?: number;
  /** Base angular radius (radians) of a cluster's cap on the shell. Sized so
   * the caps tile the sphere with a little overlap: much tighter and regions
   * sit as isolated patches in empty space, much wider and they dissolve into
   * one uniform field with no legible regions at all. For N shell clusters a
   * cap covers (1 - cos α)/2 of the sphere, so ~0.75 rad over ten clusters is
   * a little more than full coverage. */
  capSpread?: number;
  /** Rotates the whole anchor distribution, so no region sits dead-centre
   * facing the default camera. */
  tilt?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** FNV-1a, normalised to [0, 1) — the same deterministic jitter source the
 * rest of the lens uses, so positions never depend on iteration order. */
function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** An orthonormal pair spanning the plane tangent to `dir`. */
function tangentBasis(dir: Vec3): [Vec3, Vec3] {
  const reference: Vec3 = Math.abs(dir.y) > 0.92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(dir, reference));
  const v = normalize(cross(dir, u));
  return [u, v];
}

/**
 * Rotate `dir` away from itself by `angle` radians, in the tangent direction
 * given by `azimuth`. This is how every child is placed relative to its
 * parent: the result is still a unit vector, so nodes stay on the sphere and
 * only their radius decides depth.
 */
function offsetDirection(dir: Vec3, u: Vec3, v: Vec3, angle: number, azimuth: number): Vec3 {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const cosAz = Math.cos(azimuth);
  const sinAz = Math.sin(azimuth);
  return normalize({
    x: cos * dir.x + sin * (cosAz * u.x + sinAz * v.x),
    y: cos * dir.y + sin * (cosAz * u.y + sinAz * v.y),
    z: cos * dir.z + sin * (cosAz * u.z + sinAz * v.z),
  });
}

/** Evenly spread `count` directions over the sphere (golden-angle spiral). */
function anchorDirection(index: number, count: number, tilt: number): Vec3 {
  const y = count === 1 ? 0 : 1 - (2 * index + 1) / count;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * GOLDEN_ANGLE + tilt;
  return normalize({ x: ring * Math.cos(theta), y, z: ring * Math.sin(theta) });
}

/**
 * Lay the graph out as a globe.
 *
 * `clusterOrder` fixes which cap each cluster gets: as long as the order is
 * stable, a cluster keeps the same region of the globe across sessions, data
 * refreshes, and demo/live swaps. Clusters present in the nodes but missing
 * from `clusterOrder` are appended in first-seen order.
 */
export function computeGlobeLayout(
  nodes: GlobeLayoutInputNode[],
  clusterOrder: string[],
  options: GlobeLayoutOptions = {},
): { positions: Map<string, GlobePosition>; regions: GlobeRegion[] } {
  const radius = options.radius ?? 1000;
  const shellDepth = options.shellDepth ?? 0.3;
  const coreScale = options.coreScale ?? 0.19;
  const capSpread = options.capSpread ?? 0.8;
  const tilt = options.tilt ?? 0.42;
  const coreClusterId = options.coreClusterId;
  const coreRadius = radius * coreScale;

  const byCluster = new Map<string, GlobeLayoutInputNode[]>();
  for (const node of nodes) {
    const members = byCluster.get(node.clusterId);
    if (members) members.push(node);
    else byCluster.set(node.clusterId, [node]);
  }

  const ordered = clusterOrder.filter((id) => byCluster.has(id));
  for (const id of byCluster.keys()) if (!ordered.includes(id)) ordered.push(id);

  const shellClusters = ordered.filter((id) => id !== coreClusterId);
  const positions = new Map<string, GlobePosition>();
  const regions: GlobeRegion[] = [];
  // Every node's unit direction, kept so children can be placed relative to
  // their parent rather than re-derived from the cluster anchor.
  const directions = new Map<string, Vec3>();

  let shellIndex = 0;
  for (const clusterId of ordered) {
    const members = byCluster.get(clusterId)!;
    const isCore = clusterId === coreClusterId;
    const anchorDir = isCore
      ? { x: 0, y: 0, z: 1 }
      : anchorDirection(shellIndex++, Math.max(shellClusters.length, 1), tilt);
    const [anchorU, anchorV] = tangentBasis(anchorDir);

    // Denser clusters claim a slightly wider cap so their internal spread
    // doesn't pile up; the clamp keeps any one region from swallowing the globe.
    const density = Math.min(members.length / 600, 1);
    const cap = Math.min(1.05, Math.max(0.28, capSpread * (0.85 + density * 0.28)));

    const hubs = members.filter((n) => n.tier === 0);
    const hubDirs = new Map<string, Vec3>();
    const hubBasis = new Map<string, [Vec3, Vec3]>();
    const hubSpread = new Map<string, number>();

    hubs.forEach((hub, index) => {
      // Hub 0 owns the middle of the region; the rest ring around it, which
      // is what makes a cluster read as one region with internal structure
      // instead of N unrelated blobs.
      const azimuth = hubs.length <= 1 ? 0 : (index / hubs.length) * Math.PI * 2 + hash01(hub.id) * 0.5;
      const angle = index === 0 ? 0 : cap * (0.45 + hash01(`${hub.id}:hub`) * 0.35);
      const dir = index === 0 ? anchorDir : offsetDirection(anchorDir, anchorU, anchorV, angle, azimuth);
      const basis = tangentBasis(dir);
      hubDirs.set(hub.id, dir);
      hubBasis.set(hub.id, basis);
      // Each hub's children fan across most of its share of the cap, so a
      // region reads as one continuous web rather than a bundle of spikes.
      hubSpread.set(hub.id, cap * (index === 0 ? 0.85 : 0.55));
      directions.set(hub.id, dir);

      if (isCore) {
        // The core's primary hub sits exactly at the centre of the globe —
        // this is the seat the active agent's node is framed in.
        const depth = index === 0 ? 0 : coreRadius * (0.35 + hash01(`${hub.id}:r`) * 0.4);
        positions.set(hub.id, { id: hub.id, x: dir.x * depth, y: dir.y * depth, z: dir.z * depth });
      } else {
        const r = radius * (1 - 0.03 * hash01(`${hub.id}:r`));
        positions.set(hub.id, { id: hub.id, x: dir.x * r, y: dir.y * r, z: dir.z * r });
      }
    });

    // Fall back to the cluster anchor for any node whose hub wasn't declared
    // (live data can arrive mid-write) rather than dropping it on the floor.
    const dirOf = (id: string): Vec3 => directions.get(id) ?? hubDirs.get(id) ?? anchorDir;
    const basisOf = (id: string): [Vec3, Vec3] => hubBasis.get(id) ?? [anchorU, anchorV];

    for (const tier of [1, 2] as const) {
      for (const node of members) {
        if (node.tier !== tier) continue;
        const parentId = tier === 1 ? node.hubId : node.parentId;
        const parentDir = dirOf(parentId);
        const [u, v] = tier === 1 ? basisOf(parentId) : tangentBasis(parentDir);
        const spread =
          tier === 1
            ? hubSpread.get(node.hubId) ?? cap * 0.6
            : (hubSpread.get(node.hubId) ?? cap * 0.6) * 0.3;
        // Exponent < 0.5 concentrates members toward the middle of the cap
        // while still reaching its edge: each hub gets a dense core that fades
        // into a halo, which is what makes a region read as a knot in a web
        // rather than as evenly-sprayed dust. (0.5 would be area-uniform.)
        //
        // A small minority of members then wander well past their cap. Without
        // them the caps tile into visible bands with dead space between; with
        // them the globe carries an even haze that the dense cores sit inside —
        // and it's also true to the data, since plenty of real entities belong
        // to one region while living next to another. Kept to ~12% so a region
        // stays somewhere you can point at: Lens Only has to visibly empty the
        // rest of the globe, and it can't if every region is everywhere.
        const wander = hash01(`${node.id}:w`);
        const reach = tier === 1 && wander > 0.88 ? 1.5 + wander * 1.3 : 1;
        const angle = Math.min(
          Math.PI * 0.6,
          spread * reach * Math.pow(hash01(`${node.id}:a`), 0.42),
        );
        const azimuth = hash01(`${node.id}:z`) * Math.PI * 2;
        const dir = offsetDirection(parentDir, u, v, angle, azimuth);
        directions.set(node.id, dir);

        let r: number;
        if (isCore) {
          // Uniform-in-ball (cube root) so the core is a solid volume, not a
          // shell with a hollow middle.
          r = coreRadius * Math.cbrt(hash01(`${node.id}:r`)) * (tier === 1 ? 1 : 0.85);
        } else {
          // Biased toward the surface: most of the field is a skin, a
          // minority sinks into the shell and reads as depth.
          const inward = shellDepth * Math.pow(hash01(`${node.id}:r`), 1.7);
          r = radius * (1 - inward);
        }
        positions.set(node.id, { id: node.id, x: dir.x * r, y: dir.y * r, z: dir.z * r });
      }
    }

    const anchor = isCore
      ? { x: 0, y: 0, z: 0 }
      : { x: anchorDir.x * radius, y: anchorDir.y * radius, z: anchorDir.z * radius };
    let extent = isCore ? coreRadius : radius * 0.08;
    for (const node of members) {
      const p = positions.get(node.id);
      if (!p) continue;
      const distance = Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
      if (distance > extent) extent = distance;
    }

    regions.push({
      clusterId,
      x: anchor.x,
      y: anchor.y,
      z: anchor.z,
      nx: anchorDir.x,
      ny: anchorDir.y,
      nz: anchorDir.z,
      radius: extent,
      nodeCount: members.length,
      core: isCore,
    });
  }

  return { positions, regions };
}
