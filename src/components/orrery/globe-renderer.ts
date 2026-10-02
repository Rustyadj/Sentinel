// Canvas renderer for the Orrery globe. It owns camera, projection and
// drawing; it knows nothing about React or Sentinel's data model. Agents are
// supplied from outside and animate between hub nodes only while `working`.

import { buildGlobeLayout, hexToRgb, rgba, type GlobeLayout, type RGB, type Vec3 } from "./globe-layout";

const TAU = Math.PI * 2;
const CAMERA_DISTANCE = 3.4;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.8;

export interface GlobeAgent {
  id: string;
  name: string;
  color: string;
  working: boolean;
}

interface Probe {
  id: string;
  name: string;
  rgb: RGB;
  home: number;
  working: boolean;
  pos: Vec3;
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
  lift: number;
  trail: Vec3[];
  sx: number;
  sy: number;
}

export interface GlobeOptions {
  /** Horizontal globe offset in px, to clear overlaid panels. */
  offsetX: () => number;
  /** Globe radius as a fraction of the shorter stage side. */
  scale: number;
  onFollowChange?: (agentId: string | null) => void;
  onLensChange?: (regionIndex: number) => void;
}

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
  const da = ra > 0.001 ? { x: a.x / ra, y: a.y / ra, z: a.z / ra } : { x: b.x / (rb || 1), y: b.y / (rb || 1), z: b.z / (rb || 1) };
  const db = rb > 0.001 ? { x: b.x / rb, y: b.y / rb, z: b.z / rb } : da;
  const dot = Math.max(-1, Math.min(1, da.x * db.x + da.y * db.y + da.z * db.z));
  const om = Math.acos(dot), so = Math.sin(om);
  const d = so < 1e-4 ? da : (() => {
    const k1 = Math.sin((1 - u) * om) / so, k2 = Math.sin(u * om) / so;
    return { x: da.x * k1 + db.x * k2, y: da.y * k1 + db.y * k2, z: da.z * k1 + db.z * k2 };
  })();
  const r = ra + (rb - ra) * u + lift * Math.sin(Math.PI * u);
  return { x: d.x * r, y: d.y * r, z: d.z * r };
}

export class GlobeRenderer {
  private layout: GlobeLayout;
  private ctx: CanvasRenderingContext2D;
  private probes: Probe[] = [];
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
  private raf = 0;
  private last = 0;
  private reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private sx: Float32Array;
  private sy: Float32Array;
  private depth: Float32Array;
  private labelRects: { x: number; y: number; w: number; i: number }[] = [];
  private ro: ResizeObserver;
  private cleanup: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement, private opts: GlobeOptions, agentSlots = 8) {
    this.layout = buildGlobeLayout(agentSlots);
    this.ctx = canvas.getContext("2d")!;
    const n = this.layout.nodeCount;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.depth = new Float32Array(n);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bind();
    this.raf = requestAnimationFrame((t) => { this.last = t; this.raf = requestAnimationFrame(this.frame); });
  }

  get regionLabels() { return this.layout.regions.map((r) => ({ label: r.label, color: r.color })); }
  get activeLens() { return this.lens; }

  setAgents(agents: GlobeAgent[]) {
    const prev = new Map(this.probes.map((p) => [p.id, p]));
    this.probes = agents.slice(0, this.layout.homes.length).map((a, k) => {
      const existing = prev.get(a.id);
      const home = this.layout.homes[k];
      const hp = { x: this.layout.x[home], y: this.layout.y[home], z: this.layout.z[home] };
      if (existing) { existing.name = a.name; existing.rgb = hexToRgb(a.color); existing.working = a.working; existing.home = home; return existing; }
      return { id: a.id, name: a.name, rgb: hexToRgb(a.color), home, working: a.working, pos: hp, from: hp, to: hp, t: 0, dur: 0.01, lift: 0, trail: [], sx: 0, sy: 0 };
    });
    if (this.follow && !this.probes.some((p) => p.id === this.follow)) this.setFollow(null);
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
      const r = this.layout.regions[i];
      if (!r.core) {
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
    const wheel = (e: WheelEvent) => {
      if (ignore(e)) return;
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0012));
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("wheel", wheel);
    });
  }

  private pickHub() {
    const hubs = this.layout.hubs;
    return hubs[Math.floor(Math.random() * hubs.length)];
  }

  private startLeg(p: Probe, node: number) {
    const L = this.layout;
    p.from = { ...p.pos };
    p.to = { x: L.x[node], y: L.y[node], z: L.z[node] };
    const ra = Math.hypot(p.from.x, p.from.y, p.from.z), rb = Math.hypot(p.to.x, p.to.y, p.to.z);
    const da = ra > 0.01 && rb > 0.01
      ? Math.acos(Math.max(-1, Math.min(1, (p.from.x * p.to.x + p.from.y * p.to.y + p.from.z * p.to.z) / (ra * rb)))) : 1;
    p.lift = 0.06 + (0.16 * da) / Math.PI;
    p.dur = Math.max(0.8, 0.9 + da);
    p.t = 0;
  }

  private update(dt: number) {
    const L = this.layout;
    for (const p of this.probes) {
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      p.pos = arc(p.from, p.to, e, p.lift);
      if (u < 1) { p.trail.push(p.pos); if (p.trail.length > 70) p.trail.shift(); continue; }
      if (p.trail.length) p.trail.shift();
      if (this.reduce) continue;
      const atHome = Math.hypot(p.pos.x - L.x[p.home], p.pos.y - L.y[p.home], p.pos.z - L.z[p.home]) < 1e-3;
      if (p.working && p.t - p.dur > 0.8) this.startLeg(p, this.pickHub());
      else if (!p.working && !atHome) this.startLeg(p, p.home);
    }
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
    if (this.lens < 0 || region === this.lens) return 1;
    return 0.26;
  }

  private draw(fa: Probe | undefined) {
    const { ctx, w, h, layout: L } = this;
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
    for (let i = 0; i < L.nodeCount; i++) {
      const p = project(L.x[i], L.y[i], L.z[i]);
      this.sx[i] = p.x; this.sy[i] = p.y; this.depth[i] = p.d;
    }
    const dims = L.regions.map((_, i) => this.dim(i));

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
    ctx.lineWidth = 0.6;
    for (let c = 0; c < L.regions.length; c++) {
      for (let fr = 0; fr < 2; fr++) {
        ctx.beginPath();
        for (let e = 0; e < L.edgeCount; e++) {
          if (L.edgeKind[e]) continue;
          const a = L.edges[e * 2], b = L.edges[e * 2 + 1];
          if (L.region[a] !== c || (this.depth[a] + this.depth[b] > 1) !== !!fr) continue;
          ctx.moveTo(this.sx[a], this.sy[a]); ctx.lineTo(this.sx[b], this.sy[b]);
        }
        ctx.strokeStyle = rgba(L.regions[c].tint, (fr ? 0.11 : 0.035) * dims[c]);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    for (let e = 0; e < L.edgeCount; e++) {
      if (L.edgeKind[e] !== 1) continue;
      const a = L.edges[e * 2], b = L.edges[e * 2 + 1];
      if (Math.min(dims[L.region[a]], dims[L.region[b]]) < 0.5) continue;
      ctx.moveTo(this.sx[a], this.sy[a]); ctx.lineTo(this.sx[b], this.sy[b]);
    }
    ctx.strokeStyle = "rgba(90,99,166,.075)"; ctx.stroke();
    ctx.lineWidth = 1;
    for (let e = 0; e < L.edgeCount; e++) {
      if (L.edgeKind[e] !== 2) continue;
      const a = L.edges[e * 2], b = L.edges[e * 2 + 1], r = L.regions[L.region[b]];
      const g = ctx.createLinearGradient(this.sx[a], this.sy[a], this.sx[b], this.sy[b]);
      g.addColorStop(0, "rgba(169,139,245,.28)"); g.addColorStop(1, rgba(r.rgb, 0.14 * dims[L.region[b]] * (0.4 + this.depth[b])));
      ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(this.sx[a], this.sy[a]); ctx.lineTo(this.sx[b], this.sy[b]); ctx.stroke();
    }

    const alphas = [0.14, 0.36, 0.82], zs = Math.sqrt(this.zoom);
    for (let c = 0; c < L.regions.length; c++) {
      for (let bd = 0; bd < 3; bd++) {
        ctx.beginPath();
        for (let i = 0; i < L.nodeCount; i++) {
          if (L.region[i] !== c || L.tier[i] === 0) continue;
          const d = this.depth[i], b = d < 0.42 ? 0 : d < 0.66 ? 1 : 2;
          if (b !== bd) continue;
          const s = (L.tier[i] === 2 ? 0.9 : 1.35) * (0.6 + 0.7 * d) * zs;
          ctx.rect(this.sx[i] - s / 2, this.sy[i] - s / 2, s, s);
        }
        ctx.fillStyle = rgba(L.regions[c].tint, alphas[bd] * dims[c]); ctx.fill();
      }
    }
    for (let i = 0; i < L.nodeCount; i++) {
      if (L.tier[i] !== 0) continue;
      const r = L.regions[L.region[i]], major = i === r.hub;
      const sz = (major ? 30 : 15) * (0.5 + 0.6 * this.depth[i]) * zs;
      ctx.globalAlpha = dims[L.region[i]] * (0.25 + 0.75 * this.depth[i]) * 0.8;
      ctx.drawImage(glow(major ? r.rgb : r.tint), this.sx[i] - sz / 2, this.sy[i] - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    for (const p of this.probes) {
      const hp = project(L.x[p.home], L.y[p.home], L.z[p.home]);
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
      if (p === fa) {
        ctx.strokeStyle = rgba(p.rgb, 0.8); ctx.lineWidth = 1;
        ctx.strokeRect(p.sx - 12, p.sy - 12, 24, 24);
      }
    }

    // Region labels, hit-tested on click.
    this.labelRects = [];
    ctx.textAlign = "center"; ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    const placed: Array<[number, number]> = [];
    L.regions.forEach((r, i) => {
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
  }
}
