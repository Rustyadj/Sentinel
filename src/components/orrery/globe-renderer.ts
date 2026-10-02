// Canvas renderer for the Orrery globe. It owns camera, projection and
// drawing; it knows nothing about React or how Sentinel fetches data.
//
// Everything drawn comes from a GlobeModel (the real graph) and from agents
// and events supplied by the caller. The renderer never invents nodes,
// edges, or movement: a probe only travels when `dispatch` hands it a node
// that a real event touched, and it returns home only when its agent is idle.

import { hexToRgb, mix, rgba, type GlobeModel, type RGB, type Vec3 } from "./globe-model";

const TAU = Math.PI * 2;
const CAMERA_DISTANCE = 3.4;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.8;
const DWELL_SECONDS = 1.4;
const HEAT_HALF_LIFE = 14;
const MAX_QUEUE = 8;
const NEUTRAL: RGB = hexToRgb("#95a9cc");

export interface GlobeAgent {
  id: string;
  name: string;
  color: string;
  working: boolean;
  /** Index key of the agent's own graph node, when the graph has one. */
  nodeId: string | null;
}

export interface GlobeOptions {
  /** Horizontal globe offset in px, to clear overlaid panels. */
  offsetX: () => number;
  /** Globe radius as a fraction of the shorter stage side. */
  scale: number;
  onFollowChange?: (agentId: string | null) => void;
  onLensChange?: (regionIndex: number) => void;
}

interface Probe {
  id: string;
  name: string;
  rgb: RGB;
  working: boolean;
  nodeId: string | null;
  slot: number;
  home: Vec3;
  pos: Vec3;
  from: Vec3;
  to: Vec3;
  phase: "rest" | "travel" | "dwell";
  returning: boolean;
  target: number;
  t: number;
  dur: number;
  lift: number;
  queue: number[];
  trail: Vec3[];
  sx: number;
  sy: number;
}

interface Heat { v: number; rgb: RGB }
interface Ripple { node: number; rgb: RGB; t: number }

const sprites = new Map<string, HTMLCanvasElement>();
function glow(rgb: RGB) {
  const key = rgb.join();
  const hit = sprites.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(rgb, 1));
  gr.addColorStop(0.18, rgba(rgb, 0.55));
  gr.addColorStop(0.5, rgba(rgb, 0.12));
  gr.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function arc(a: Vec3, b: Vec3, u: number, lift: number): Vec3 {
  const ra = Math.hypot(a.x, a.y, a.z), rb = Math.hypot(b.x, b.y, b.z);
  const unit = (v: Vec3, r: number): Vec3 | null => (r > 0.001 ? { x: v.x / r, y: v.y / r, z: v.z / r } : null);
  const da = unit(a, ra) ?? unit(b, rb) ?? { x: 0, y: 0, z: 1 };
  const db = unit(b, rb) ?? da;
  const dot = Math.max(-1, Math.min(1, da.x * db.x + da.y * db.y + da.z * db.z));
  const om = Math.acos(dot), so = Math.sin(om);
  const d = so < 1e-4 ? da : (() => {
    const k1 = Math.sin((1 - u) * om) / so, k2 = Math.sin(u * om) / so;
    return { x: da.x * k1 + db.x * k2, y: da.y * k1 + db.y * k2, z: da.z * k1 + db.z * k2 };
  })();
  const r = ra + (rb - ra) * u + lift * Math.sin(Math.PI * u);
  return { x: d.x * r, y: d.y * r, z: d.z * r };
}

const EMPTY_MODEL: GlobeModel = {
  nodeCount: 0, edgeCount: 0, ids: [], labels: [], types: [], x: new Float32Array(0), y: new Float32Array(0), z: new Float32Array(0),
  region: new Uint8Array(0), isHub: new Uint8Array(0), edges: new Uint32Array(0), edgeWeight: new Float32Array(0),
  regions: [], indexById: new Map(), adjacency: [],
};

export class GlobeRenderer {
  private model: GlobeModel = EMPTY_MODEL;
  private ctx: CanvasRenderingContext2D;
  private probes: Probe[] = [];
  private heat = new Map<number, Heat>();
  private ripples: Ripple[] = [];
  private w = 0;
  private h = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private yaw = 0.5;
  private pitch = 0.28;
  private zoom = 1;
  private follow: string | null = null;
  private lens = -1;
  private targetYaw: number | null = null;
  private targetPitch = 0;
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private pointer: { x: number; y: number } | null = null;
  private hover = -1;
  private raf = 0;
  private last = 0;
  private reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private depth = new Float32Array(0);
  private labelRects: { x: number; y: number; w: number; i: number }[] = [];
  private ro: ResizeObserver;
  private cleanup: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement, private opts: GlobeOptions) {
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bind();
    this.raf = requestAnimationFrame((t) => { this.last = t; this.raf = requestAnimationFrame(this.frame); });
  }

  get regionLabels() { return this.model.regions.map((r) => ({ label: r.label, color: r.color })); }

  setModel(model: GlobeModel) {
    this.model = model;
    this.sx = new Float32Array(model.nodeCount);
    this.sy = new Float32Array(model.nodeCount);
    this.depth = new Float32Array(model.nodeCount);
    this.heat.clear();
    this.ripples = [];
    // Probes keep their identity across graph refreshes; only their anchors move.
    for (const p of this.probes) this.anchorProbe(p);
  }

  setAgents(agents: GlobeAgent[]) {
    const prev = new Map(this.probes.map((p) => [p.id, p]));
    this.probes = agents.map((a, slot) => {
      const probe = prev.get(a.id) ?? this.newProbe(a, slot);
      probe.name = a.name; probe.rgb = hexToRgb(a.color); probe.working = a.working; probe.nodeId = a.nodeId; probe.slot = slot;
      this.anchorProbe(probe);
      return probe;
    });
    if (this.follow && !this.probes.some((p) => p.id === this.follow)) this.setFollow(null);
  }

  /** A real event touched these graph nodes on behalf of an agent. */
  dispatch(agentId: string, nodeIds: string[]) {
    const probe = this.probes.find((p) => p.id === agentId);
    if (!probe) return;
    for (const id of nodeIds) {
      const idx = this.model.indexById.get(id);
      if (idx === undefined || probe.queue.includes(idx)) continue;
      if (probe.queue.length >= MAX_QUEUE) break;
      probe.queue.push(idx);
    }
  }

  setFollow(id: string | null) {
    this.follow = id;
    this.targetYaw = null;
    this.opts.onFollowChange?.(id);
  }

  setLens(i: number) {
    this.lens = i;
    if (i >= 0) {
      this.setFollow(null);
      const r = this.model.regions[i];
      if (r && !r.core) {
        this.targetYaw = Math.atan2(-r.anchor.x, r.anchor.z);
        this.targetPitch = Math.atan2(r.anchor.y, Math.hypot(r.anchor.x, r.anchor.z));
      }
    }
    this.opts.onLensChange?.(i);
  }

  zoomBy(k: number) { this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * k)); }
  reset() { this.zoom = 1; this.targetYaw = 0.5; this.targetPitch = 0.28; this.setLens(-1); }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanup.forEach((f) => f());
  }

  private newProbe(a: GlobeAgent, slot: number): Probe {
    const home = this.homeFor(a.nodeId, slot);
    return {
      id: a.id, name: a.name, rgb: hexToRgb(a.color), working: a.working, nodeId: a.nodeId, slot, home,
      pos: home, from: home, to: home, phase: "rest", returning: false, target: -1, t: 0, dur: 1, lift: 0, queue: [], trail: [], sx: 0, sy: 0,
    };
  }

  /** An agent rests on its own graph node; with none, in a small ring at the core. */
  private homeFor(nodeId: string | null, slot: number): Vec3 {
    const idx = nodeId ? this.model.indexById.get(nodeId) : undefined;
    if (idx !== undefined) return { x: this.model.x[idx], y: this.model.y[idx], z: this.model.z[idx] };
    const th = slot * 2.399963 + 1.1;
    return { x: Math.cos(th) * 0.11, y: Math.sin(th) * 0.11, z: 0 };
  }

  private anchorProbe(p: Probe) {
    const home = this.homeFor(p.nodeId, p.slot);
    const wasAtHome = p.phase === "rest" && p.pos === p.home;
    p.home = home;
    if (wasAtHome) { p.pos = home; p.from = home; p.to = home; }
    p.queue = p.queue.filter((i) => i < this.model.nodeCount);
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.floor(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(this.h * this.dpr));
  }

  private bind() {
    const host = this.host;
    const ignore = (e: Event) => (e.target as HTMLElement).closest("[data-orrery-ui]");
    const down = (e: PointerEvent) => {
      if (ignore(e)) return;
      this.dragging = true; this.moved = false; this.lastX = e.clientX; this.lastY = e.clientY;
      host.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      this.pointer = ignore(e) ? null : { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) { this.moved = true; if (this.follow) this.setFollow(null); this.targetYaw = null; }
      this.yaw += dx * 0.005;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dy * 0.005));
      this.lastX = e.clientX; this.lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      const was = this.dragging; this.dragging = false;
      if (!was || this.moved) return;
      const rect = host.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const probe = this.probes.find((p) => (p.sx - mx) ** 2 + (p.sy - my) ** 2 < 196);
      if (probe) { this.setFollow(this.follow === probe.id ? null : probe.id); return; }
      const label = this.labelRects.find((l) => Math.abs(l.x - mx) < l.w / 2 && Math.abs(l.y - my) < 9);
      if (label) this.setLens(this.lens === label.i ? -1 : label.i);
    };
    const leave = () => { this.pointer = null; };
    const wheel = (e: WheelEvent) => {
      if (ignore(e)) return;
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0012));
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
    });
  }

  private startLeg(p: Probe, to: Vec3, target: number, returning: boolean) {
    p.from = { ...p.pos }; p.to = to; p.target = target; p.returning = returning;
    const ra = Math.hypot(p.from.x, p.from.y, p.from.z), rb = Math.hypot(to.x, to.y, to.z);
    const da = ra > 0.01 && rb > 0.01
      ? Math.acos(Math.max(-1, Math.min(1, (p.from.x * to.x + p.from.y * to.y + p.from.z * to.z) / (ra * rb)))) : 1;
    p.lift = 0.06 + (0.16 * da) / Math.PI;
    p.dur = Math.max(0.8, 0.9 + da);
    p.t = 0; p.phase = "travel";
  }

  private touch(node: number, rgb: RGB) {
    const set = (i: number, v: number) => {
      const cur = this.heat.get(i);
      if (!cur || cur.v < v) this.heat.set(i, { v, rgb });
    };
    set(node, 1);
    for (const j of this.model.adjacency[node] ?? []) set(j, 0.45);
    this.ripples.push({ node, rgb, t: 0 });
  }

  private update(dt: number) {
    const M = this.model;
    for (const p of this.probes) {
      p.t += dt;
      if (p.phase === "travel") {
        const u = Math.min(1, p.t / p.dur);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        p.pos = arc(p.from, p.to, e, p.lift);
        p.trail.push(p.pos); if (p.trail.length > 70) p.trail.shift();
        if (u >= 1) {
          if (p.returning) { p.phase = "rest"; p.pos = p.to; }
          else { p.phase = "dwell"; p.t = 0; p.pos = p.to; this.touch(p.target, p.rgb); }
        }
        continue;
      }
      if (p.trail.length) p.trail.shift();
      if (p.phase === "dwell" && p.t < DWELL_SECONDS) continue;
      const next = p.queue.shift();
      if (next !== undefined && !this.reduce) { this.startLeg(p, { x: M.x[next], y: M.y[next], z: M.z[next] }, next, false); continue; }
      if (next !== undefined) { p.pos = { x: M.x[next], y: M.y[next], z: M.z[next] }; this.touch(next, p.rgb); }
      const atHome = p.pos.x === p.home.x && p.pos.y === p.home.y && p.pos.z === p.home.z;
      if (!p.working && !atHome && !this.reduce) this.startLeg(p, p.home, -1, true);
      else if (!p.working && !atHome) p.pos = p.home;
      if (p.phase === "dwell") p.phase = "rest";
    }
    const decay = Math.exp(-dt / HEAT_HALF_LIFE);
    for (const [i, h] of this.heat) { h.v *= decay; if (h.v < 0.02) this.heat.delete(i); }
    for (let k = this.ripples.length - 1; k >= 0; k--) { this.ripples[k].t += dt; if (this.ripples[k].t > 1.3) this.ripples.splice(k, 1); }
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    const fa = this.follow ? this.probes.find((p) => p.id === this.follow) : undefined;
    if (fa && !this.dragging) {
      const p = fa.pos, r = Math.hypot(p.x, p.y, p.z);
      if (r > 0.35) {
        const ty = Math.atan2(-p.x, p.z), tp = Math.atan2(p.y, Math.hypot(p.x, p.z));
        this.yaw += angDiff(this.yaw, ty) * Math.min(1, dt * 1.6);
        this.pitch += (Math.max(-1.1, Math.min(1.1, tp)) - this.pitch) * Math.min(1, dt * 1.6);
      }
    } else if (this.targetYaw !== null && !this.dragging) {
      this.yaw += angDiff(this.yaw, this.targetYaw) * Math.min(1, dt * 2.4);
      this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 2.4);
      if (Math.abs(angDiff(this.yaw, this.targetYaw)) < 0.002) this.targetYaw = null;
    } else if (!this.dragging && !this.reduce) this.yaw += dt * 0.035;
    this.draw(fa);
    this.raf = requestAnimationFrame(this.frame);
  };

  private dim(region: number) {
    return this.lens < 0 || region === this.lens ? 1 : 0.26;
  }

  private draw(fa: Probe | undefined) {
    const { ctx, w, h, model: M } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cyw = Math.cos(this.yaw), syw = Math.sin(this.yaw), cpt = Math.cos(this.pitch), spt = Math.sin(this.pitch);
    const gR = Math.min(w, h) * this.opts.scale * this.zoom, f = gR * CAMERA_DISTANCE;
    const cx = w / 2 + this.opts.offsetX(), cy = h / 2;
    const project = (x: number, y: number, z: number) => {
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
      const y2 = y * cpt - z1 * spt, z2 = y * spt + z1 * cpt, p = f / (CAMERA_DISTANCE - z2);
      return { x: cx + x1 * p, y: cy - y2 * p, d: (z2 + 1) * 0.5, z: z2 };
    };
    for (let i = 0; i < M.nodeCount; i++) {
      const p = project(M.x[i], M.y[i], M.z[i]);
      this.sx[i] = p.x; this.sy[i] = p.y; this.depth[i] = p.d;
    }
    const dims = M.regions.map((_, i) => this.dim(i));
    const zs = Math.sqrt(this.zoom);

    const atm = ctx.createRadialGradient(cx, cy, gR * 0.9, cx, cy, gR * 1.12);
    atm.addColorStop(0, "rgba(70,100,190,0)"); atm.addColorStop(0.5, "rgba(70,100,190,.07)"); atm.addColorStop(1, "rgba(70,100,190,0)");
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, gR * 1.12, 0, TAU); ctx.fill();

    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(140,170,230,.05)"; ctx.beginPath();
    const trace = (pt: (s: number) => [number, number, number], steps: number) => {
      let pen = false;
      for (let s = 0; s <= steps; s++) {
        const [x, y, z] = pt(s / steps), p = project(x, y, z);
        if (p.z > 0) { if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true; } else pen = false;
      }
    };
    for (let m = 0; m < 12; m++) {
      const lon = (m / 12) * TAU;
      trace((u) => { const lat = -Math.PI / 2 + u * Math.PI; return [Math.cos(lat) * Math.cos(lon) * 1.02, Math.sin(lat) * 1.02, Math.cos(lat) * Math.sin(lon) * 1.02]; }, 40);
    }
    for (let l = 1; l < 6; l++) {
      const lat = -Math.PI / 2 + (l / 6) * Math.PI;
      trace((u) => { const lon = u * TAU; return [Math.cos(lat) * Math.cos(lon) * 1.02, Math.sin(lat) * 1.02, Math.cos(lat) * Math.sin(lon) * 1.02]; }, 64);
    }
    ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    // Real relationships, coloured by the region of their source, weight → opacity.
    ctx.lineWidth = 0.8;
    for (let e = 0; e < M.edgeCount; e++) {
      const a = M.edges[e * 2], b = M.edges[e * 2 + 1];
      const ra = M.region[a], rb = M.region[b], dim = Math.min(dims[ra], dims[rb]);
      const front = (this.depth[a] + this.depth[b]) / 2;
      const cross = ra !== rb;
      const col = cross ? NEUTRAL : M.regions[ra].tint;
      ctx.strokeStyle = rgba(col, (0.05 + 0.2 * M.edgeWeight[e]) * (0.4 + front) * dim);
      ctx.beginPath(); ctx.moveTo(this.sx[a], this.sy[a]); ctx.lineTo(this.sx[b], this.sy[b]); ctx.stroke();
    }

    for (let i = 0; i < M.nodeCount; i++) {
      const r = M.regions[M.region[i]], d = dims[M.region[i]], dz = this.depth[i];
      const hub = M.isHub[i] === 1;
      const sz = (hub ? 26 : 12) * (0.5 + 0.6 * dz) * zs;
      ctx.globalAlpha = d * (0.3 + 0.7 * dz) * (hub ? 0.85 : 0.7);
      ctx.drawImage(glow(hub ? r.rgb : mix(r.tint, r.rgb, 0.4)), this.sx[i] - sz / 2, this.sy[i] - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    for (const [i, hv] of this.heat) {
      const sz = (10 + 26 * hv.v) * (0.6 + 0.5 * this.depth[i]);
      ctx.globalAlpha = hv.v * (0.35 + 0.65 * this.depth[i]);
      ctx.drawImage(glow(hv.rgb), this.sx[i] - sz / 2, this.sy[i] - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    for (const rp of this.ripples) {
      const u = rp.t / 1.3;
      ctx.strokeStyle = rgba(rp.rgb, (1 - u) * 0.8 * (0.4 + 0.6 * this.depth[rp.node]));
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(this.sx[rp.node], this.sy[rp.node], 4 + u * 26, 0, TAU); ctx.stroke();
    }

    for (const p of this.probes) {
      const hp = project(p.home.x, p.home.y, p.home.z);
      const pp = project(p.pos.x, p.pos.y, p.pos.z);
      p.sx = pp.x; p.sy = pp.y;
      if (p.trail.length > 1) {
        ctx.lineWidth = p === fa ? 2.2 : 1.6;
        for (let k = 1; k < p.trail.length; k++) {
          const a = project(p.trail[k - 1].x, p.trail[k - 1].y, p.trail[k - 1].z), b = project(p.trail[k].x, p.trail[k].y, p.trail[k].z);
          const u = k / p.trail.length;
          ctx.strokeStyle = rgba(p.rgb, u * u * 0.9 * (0.4 + 0.6 * b.d));
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      const tg = ctx.createLinearGradient(hp.x, hp.y, pp.x, pp.y);
      tg.addColorStop(0, rgba(p.rgb, 0.5)); tg.addColorStop(1, rgba(p.rgb, 0.08));
      ctx.strokeStyle = tg; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(pp.x, pp.y); ctx.stroke();
      const big = p === fa ? 46 : 34;
      ctx.globalAlpha = 0.5 + 0.5 * pp.d;
      ctx.drawImage(glow(p.rgb), pp.x - big / 2, pp.y - big / 2, big, big);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(pp.x, pp.y, p === fa ? 3 : 2.4, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.lineJoin = "round";
    for (const p of this.probes) {
      ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
      const lab = p.name.toUpperCase();
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(1,4,10,.85)"; ctx.strokeText(lab, p.sx + 10, p.sy - 6);
      ctx.fillStyle = rgba(p.rgb, 1); ctx.fillText(lab, p.sx + 10, p.sy - 6);
      if (p === fa) { ctx.strokeStyle = rgba(p.rgb, 0.8); ctx.lineWidth = 1; ctx.strokeRect(p.sx - 12, p.sy - 12, 24, 24); }
    }

    // Region labels (only regions that actually hold nodes), hit-tested on click.
    this.labelRects = [];
    ctx.textAlign = "center"; ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    const placed: Array<[number, number]> = [];
    M.regions.forEach((r, i) => {
      if (r.nodeCount === 0) return;
      let x: number, y: number, z: number;
      if (r.core) { const p = project(0, 0, 0); x = p.x; y = p.y + gR * 0.3; z = 1; }
      else { const p = project(r.anchor.x * 1.04, r.anchor.y * 1.04, r.anchor.z * 1.04); x = p.x; y = p.y; z = p.z; }
      if (z < 0.12 || placed.some((o) => Math.abs(o[0] - x) < 100 && Math.abs(o[1] - y) < 32)) return;
      placed.push([x, y]);
      const text = r.label.toUpperCase();
      ctx.globalAlpha = Math.min(1, (this.lens === i ? 0.95 : 0.35 + 0.55 * z) * (dims[i] < 1 ? 0.6 : 1));
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(1,4,10,.85)"; ctx.strokeText(text, x, y);
      ctx.fillStyle = r.color; ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
      this.labelRects.push({ x, y, w: ctx.measureText(text).width, i });
    });

    // Hover: the real title and type of the node under the pointer.
    this.hover = -1;
    if (this.pointer && !this.dragging) {
      let best = -1, bd = 144;
      for (let i = 0; i < M.nodeCount; i++) {
        if (this.depth[i] < 0.45 || !dims[M.region[i]] || dims[M.region[i]] < 1) continue;
        const d = (this.sx[i] - this.pointer.x) ** 2 + (this.sy[i] - this.pointer.y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      this.hover = best;
    }
    if (this.hover >= 0) {
      const i = this.hover;
      const title = M.labels[i].length > 44 ? `${M.labels[i].slice(0, 43)}…` : M.labels[i];
      const sub = `${M.types[i]} · ${M.regions[M.region[i]].label}`;
      ctx.textAlign = "left"; ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      const wTitle = ctx.measureText(title).width;
      ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
      const bw = Math.max(wTitle, ctx.measureText(sub).width) + 20, bx = Math.min(this.sx[i] + 14, w - bw - 8), by = this.sy[i] - 12;
      ctx.fillStyle = "rgba(5,9,17,.92)"; ctx.strokeStyle = "rgba(40,58,88,.8)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, 38, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e9edf5"; ctx.font = "12px ui-sans-serif, system-ui, sans-serif"; ctx.fillText(title, bx + 10, by + 13);
      ctx.fillStyle = "#8391a6"; ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'; ctx.fillText(sub, bx + 10, by + 28);
    }
  }
}
