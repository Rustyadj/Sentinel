// Deterministic globe layout for the Orrery: twelve knowledge regions on a
// Fibonacci sphere, an agent core at the centre, and a dust of child nodes.
// Pure data — no DOM, no canvas — so it is testable and shared by any renderer.

const TAU = Math.PI * 2;
const GOLD = Math.PI * (3 - Math.sqrt(5));

export type RGB = readonly [number, number, number];
export interface Vec3 { x: number; y: number; z: number }

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as unknown as RGB;

/** Seeded PRNG (mulberry32) so the globe is identical on every load. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Region {
  id: string;
  label: string;
  color: string;
  rgb: RGB;
  tint: RGB;
  core?: boolean;
  anchor: Vec3;
  hub: number;
}

const REGION_DEFS: ReadonlyArray<{ id: string; label: string; color: string; core?: boolean }> = [
  { id: "chat", label: "Communications", color: "#5c9fe0" },
  { id: "projects", label: "Projects", color: "#e09a52" },
  { id: "knowledge", label: "Data Lake", color: "#4a89c4" },
  { id: "memory", label: "Memory Core", color: "#57c2a8" },
  { id: "learning", label: "Workflows Engine", color: "#d4b45f" },
  { id: "security", label: "Cybersecurity Ops", color: "#9179ef" },
  { id: "code", label: "Code Repositories", color: "#dd8a4c" },
  { id: "agents", label: "Agents", color: "#a98bf5", core: true },
  { id: "infra", label: "Infrastructure", color: "#4f7fc9" },
  { id: "marketing", label: "Marketing Ops", color: "#e0a83f" },
  { id: "voice", label: "Voice", color: "#93a2d8" },
  { id: "external", label: "External Partners", color: "#b57cf0" },
];

export const AGENT_CORE_RADIUS = 0.11;

export interface GlobeLayout {
  regions: Region[];
  nodeCount: number;
  edgeCount: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  region: Uint8Array;
  /** 0 = hub, 1 = child, 2 = grandchild. */
  tier: Uint8Array;
  /** Edge endpoints, pairs. */
  edges: Uint32Array;
  /** 0 = intra-region, 1 = cross-region bridge, 2 = core spoke. */
  edgeKind: Uint8Array;
  /** Hub node indices — the places an agent can visibly "work". */
  hubs: number[];
  /** Home node index per agent slot (agentSlots long). */
  homes: number[];
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
function basis(d: Vec3): [Vec3, Vec3] {
  const r = Math.abs(d.y) > 0.92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = norm(cross(d, r));
  return [u, norm(cross(d, u))];
}
function offset(d: Vec3, u: Vec3, v: Vec3, ang: number, az: number): Vec3 {
  const s = Math.sin(ang), c = Math.cos(ang), ca = Math.cos(az), sa = Math.sin(az);
  return norm({
    x: c * d.x + s * (ca * u.x + sa * v.x),
    y: c * d.y + s * (ca * u.y + sa * v.y),
    z: c * d.z + s * (ca * u.z + sa * v.z),
  });
}

/** Build the globe. `agentSlots` is how many agent probes need a home in the core. */
export function buildGlobeLayout(agentSlots: number): GlobeLayout {
  const rand = seeded(20260922);
  const neutral = hexToRgb("#95a9cc");
  const regions: Region[] = REGION_DEFS.map((d) => {
    const rgb = hexToRgb(d.color);
    return { ...d, rgb, tint: mix(neutral, rgb, 0.5), anchor: { x: 0, y: 0, z: 1 }, hub: -1 };
  });

  const px: number[] = [], py: number[] = [], pz: number[] = [];
  const pr: number[] = [], pt: number[] = [];
  const pe: number[] = [], pk: number[] = [];
  const hubs: number[] = [];
  const add = (x: number, y: number, z: number, r: number, t: number) => {
    px.push(x); py.push(y); pz.push(z); pr.push(r); pt.push(t);
    return px.length - 1;
  };
  const link = (a: number, b: number, kind: number) => { pe.push(a, b); pk.push(kind); };

  const shell = regions.map((_, i) => i).filter((i) => !regions[i].core);
  shell.forEach((ri, si) => {
    const n = shell.length, y = 1 - (2 * si + 1) / n, ring = Math.sqrt(1 - y * y), th = si * GOLD + 0.42;
    const anchor = norm({ x: ring * Math.cos(th), y, z: ring * Math.sin(th) });
    regions[ri].anchor = anchor;
    const [u, v] = basis(anchor);
    const cap = 0.62;
    const regionHubs: { i: number; dir: Vec3; b: [Vec3, Vec3]; spread: number; kids: number[] }[] = [];
    for (let h = 0; h < 5; h++) {
      const dir = h ? offset(anchor, u, v, cap * (0.45 + rand() * 0.3), (h / 4) * TAU + rand() * 0.5) : anchor;
      const r = 1 - 0.02 * rand();
      const i = add(dir.x * r, dir.y * r, dir.z * r, ri, 0);
      hubs.push(i);
      regionHubs.push({ i, dir, b: basis(dir), spread: cap * (h ? 0.55 : 0.85), kids: [] });
    }
    regions[ri].hub = regionHubs[0].i;
    regionHubs.forEach((H, h) => {
      const count = h ? 64 : 130;
      for (let k = 0; k < count; k++) {
        const w = rand(), reach = w > 0.9 ? 1.5 + w * 1.2 : 1;
        const ang = Math.min(Math.PI * 0.6, H.spread * reach * Math.pow(rand(), 0.42));
        const dir = offset(H.dir, H.b[0], H.b[1], ang, rand() * TAU);
        const r = 1 - 0.3 * Math.pow(rand(), 1.7);
        const i = add(dir.x * r, dir.y * r, dir.z * r, ri, 1);
        link(H.i, i, 0); H.kids.push(i);
        if (rand() > 0.8) {
          const [pu, pv] = basis(dir), g = 1 + Math.floor(rand() * 3);
          for (let q = 0; q < g; q++) {
            const d2 = offset(dir, pu, pv, H.spread * 0.16 * Math.pow(rand(), 0.5), rand() * TAU);
            const r2 = r * (1 - 0.05 * rand());
            link(i, add(d2.x * r2, d2.y * r2, d2.z * r2, ri, 2), 0);
          }
        }
      }
      for (const k of H.kids) {
        if (rand() > 0.55) { const o = H.kids[Math.floor(rand() * H.kids.length)]; if (o !== k) link(k, o, 0); }
      }
      if (h) link(regionHubs[0].i, H.i, 0);
    });
  });

  const core = regions.findIndex((r) => r.core);
  const coreHub = add(0, 0, 0, core, 0);
  regions[core].hub = coreHub;
  const slots = Math.max(1, agentSlots);
  const homes: number[] = [];
  for (let k = 0; k < slots; k++) {
    const y = 1 - (2 * k + 1) / slots, ring = Math.sqrt(1 - y * y), th = k * GOLD + 1.1;
    const home = add(ring * Math.cos(th) * AGENT_CORE_RADIUS, y * AGENT_CORE_RADIUS, ring * Math.sin(th) * AGENT_CORE_RADIUS, core, 0);
    homes.push(home); link(coreHub, home, 2);
  }
  for (let k = 0; k < 420; k++) {
    const z = 2 * rand() - 1, t = rand() * TAU, rr = Math.sqrt(1 - z * z), r = 0.22 * Math.cbrt(rand());
    link(homes[Math.floor(rand() * slots)], add(rr * Math.cos(t) * r, z * r, rr * Math.sin(t) * r, core, 1), 0);
  }
  shell.forEach((ri) => link(coreHub, regions[ri].hub, 2));
  for (let b = 0; b < 380; b++) {
    const a = Math.floor(rand() * px.length), z = Math.floor(rand() * px.length);
    if (pr[a] !== pr[z] && pr[a] !== core && pr[z] !== core) link(a, z, 1);
  }

  return {
    regions, nodeCount: px.length, edgeCount: pk.length,
    x: Float32Array.from(px), y: Float32Array.from(py), z: Float32Array.from(pz),
    region: Uint8Array.from(pr), tier: Uint8Array.from(pt),
    edges: Uint32Array.from(pe), edgeKind: Uint8Array.from(pk),
    hubs, homes,
  };
}
