// Canvas renderer for the Strata graph: four translucent planes stacked in
// shallow perspective, nodes seated on their stratum, threads running between
// them. It owns projection, camera and drawing, and knows nothing about React
// or how Sentinel fetches data.
//
// Nothing here is invented. A node is drawn only if the model has it, a pulse
// travels only when `dispatch` reports a real event, and the context column
// drops only through a node the caller says is in focus.

import { STRATA, type StrataModel } from "./strata-model";

type RGB = readonly [number, number, number];

const TAU = Math.PI * 2;
const TILT = 0.3;
const IDLE_SWAY = 0.1;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.2;
const HEAT_HALF_LIFE = 12;
const PULSE_SECONDS = 1.3;

export interface StrataAgent {
  id: string;
  name: string;
  color: string;
  working: boolean;
  /** KnowledgeObject id of the agent's own graph node, when it has one. */
  nodeId: string | null;
}

export interface StrataInsets { left: number; right: number; top: number; bottom: number }

export interface StrataHover {
  label: string;
  type: string;
  stratum: string;
  x: number;
  y: number;
}

export interface StrataOptions {
  /** Screen regions covered by foreground UI; the strata centre in what is left. */
  insets: () => StrataInsets;
  onHover?: (hover: StrataHover | null) => void;
  onSelect?: (nodeId: string | null) => void;
}

interface Pulse { from: number; to: number; t: number; rgb: RGB }
interface Ripple { node: number; t: number; rgb: RGB }

const EMPTY: StrataModel = {
  nodeCount: 0, edgeCount: 0, ids: [], labels: [], types: [],
  layer: new Uint8Array(0), u: new Float32Array(0), v: new Float32Array(0), isHub: new Uint8Array(0),
  edges: new Uint32Array(0), adjacency: [], indexById: new Map(), counts: [0, 0, 0, 0],
};

function hexToRgb(hex: string): RGB {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [149, 169, 204];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;

export class StrataRenderer {
  private model: StrataModel = EMPTY;
  private ctx: CanvasRenderingContext2D;
  private agents: StrataAgent[] = [];
  private agentByNode = new Map<number, StrataAgent>();
  private focusIds: string[] = [];
  private focus = new Set<number>();
  private focusNeighbours = new Set<number>();
  private pinned = -1;
  private follow: string | null = null;
  private emphasis = -1;
  private heat = new Map<number, number>();
  private pulses: Pulse[] = [];
  private ripples: Ripple[] = [];
  private pigments: RGB[];
  private brass: RGB;
  private ink: RGB;
  private w = 0;
  private h = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private yaw = -0.62;
  private dragYaw = 0;
  private zoom = 1;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private dirty = true;
  private reduce: boolean;
  private motionQuery: MediaQueryList;
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private hover = -1;
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private ro: ResizeObserver;
  private disposers: Array<() => void> = [];
  private font: string;

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement, private opts: StrataOptions) {
    this.ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(host);
    const read = (token: string, fallback: string) => hexToRgb(css.getPropertyValue(token) || fallback);
    this.pigments = STRATA.map((s) => read(s.token, s.hex));
    this.brass = read("--primary", "#d4a95a");
    this.ink = read("--foreground", "#ebe6da");
    this.font = `500 11px ${css.fontFamily || "sans-serif"}`;

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduce = this.motionQuery.matches;
    const onMotion = () => { this.reduce = this.motionQuery.matches; this.kick(); };
    this.motionQuery.addEventListener("change", onMotion);
    this.disposers.push(() => this.motionQuery.removeEventListener("change", onMotion));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindPointer();

    const onVisible = () => { if (!document.hidden) this.kick(); };
    document.addEventListener("visibilitychange", onVisible);
    this.disposers.push(() => document.removeEventListener("visibilitychange", onVisible));

    this.kick();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  setModel(model: StrataModel) {
    this.model = model;
    this.sx = new Float32Array(model.nodeCount);
    this.sy = new Float32Array(model.nodeCount);
    this.heat.clear();
    this.pulses = [];
    this.ripples = [];
    if (this.pinned >= model.nodeCount) this.pinned = -1;
    this.indexAgents();
    this.rebuildFocus();
    this.kick();
  }

  setAgents(agents: StrataAgent[]) {
    this.agents = agents;
    this.indexAgents();
    this.rebuildFocus();
    this.kick();
  }

  /** Node ids the conversation is currently about. Unknown ids are ignored, never drawn. */
  setFocus(ids: string[]) {
    this.focusIds = ids;
    this.rebuildFocus();
    this.kick();
  }

  setFollow(agentId: string | null) {
    this.follow = agentId;
    this.rebuildFocus();
    this.kick();
  }

  /** Light one stratum and quiet the rest; -1 restores all four. */
  setEmphasis(layer: number) {
    this.emphasis = layer;
    this.kick();
  }

  /** A real event: `agentId` touched `nodeIds`. Sends a pulse down the threads. */
  dispatch(agentId: string, nodeIds: string[]) {
    const agent = this.agents.find((a) => a.id === agentId);
    const from = agent?.nodeId ? this.model.indexById.get(agent.nodeId) : undefined;
    const rgb = agent ? hexToRgb(agent.color) : this.brass;
    for (const id of nodeIds) {
      const to = this.model.indexById.get(id);
      if (to === undefined) continue;
      this.heat.set(to, Math.min(1, (this.heat.get(to) ?? 0) + 0.7));
      if (this.reduce) continue;
      if (from !== undefined && from !== to) this.pulses.push({ from, to, t: 0, rgb });
      else this.ripples.push({ node: to, t: 0, rgb });
    }
    if (this.pulses.length > 24) this.pulses.splice(0, this.pulses.length - 24);
    this.kick();
  }

  zoomBy(factor: number) {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.kick();
  }

  reset() {
    this.zoom = 1;
    this.dragYaw = 0;
    this.pinned = -1;
    this.opts.onSelect?.(null);
    this.rebuildFocus();
    this.kick();
  }

  clearPin() {
    this.pinned = -1;
    this.rebuildFocus();
    this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const dispose of this.disposers) dispose();
  }

  // ── State ───────────────────────────────────────────────────────────────

  private indexAgents() {
    this.agentByNode.clear();
    for (const a of this.agents) {
      const i = a.nodeId ? this.model.indexById.get(a.nodeId) : undefined;
      if (i !== undefined) this.agentByNode.set(i, a);
    }
  }

  private rebuildFocus() {
    this.focus.clear();
    for (const id of this.focusIds) {
      const i = this.model.indexById.get(id);
      if (i !== undefined) this.focus.add(i);
    }
    if (this.follow) {
      const a = this.agents.find((x) => x.id === this.follow);
      const i = a?.nodeId ? this.model.indexById.get(a.nodeId) : undefined;
      if (i !== undefined) this.focus.add(i);
    }
    if (this.pinned >= 0) this.focus.add(this.pinned);
    this.focusNeighbours.clear();
    for (const i of this.focus) for (const j of this.model.adjacency[i] ?? []) this.focusNeighbours.add(j);
  }

  // ── Loop ────────────────────────────────────────────────────────────────

  private kick() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private animating() {
    if (this.reduce) return false;
    return true; // idle sway, working-agent breath, pulses
  }

  private frame(now: number) {
    this.raf = 0;
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.reduce) this.clock += dt;

    // Decay heat and advance transient marks.
    if (dt > 0) {
      const k = Math.pow(0.5, dt / HEAT_HALF_LIFE);
      for (const [i, v] of this.heat) {
        const next = v * k;
        if (next < 0.02) this.heat.delete(i); else this.heat.set(i, next);
      }
      for (const p of this.pulses) p.t += dt / PULSE_SECONDS;
      for (const p of this.pulses) if (p.t >= 1) this.ripples.push({ node: p.to, t: 0, rgb: p.rgb });
      this.pulses = this.pulses.filter((p) => p.t < 1);
      for (const r of this.ripples) r.t += dt / 1.1;
      this.ripples = this.ripples.filter((r) => r.t < 1);
    }

    if (this.dirty || this.animating() || this.heat.size || this.pulses.length || this.ripples.length) {
      this.draw();
      this.dirty = false;
    }
    if (this.animating() || this.heat.size || this.pulses.length || this.ripples.length) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
    } else {
      this.last = 0;
    }
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.kick();
  }

  // ── Projection ──────────────────────────────────────────────────────────

  private frameGeometry() {
    const ins = this.opts.insets();
    const x0 = ins.left, x1 = Math.max(ins.left + 120, this.w - ins.right);
    const y0 = ins.top, y1 = Math.max(ins.top + 120, this.h - ins.bottom);
    const aw = x1 - x0, ah = y1 - y0;
    // A rotated square plane is up to √2 wider than its half-width R, so the
    // fit is computed on the diagonal.
    const gap = Math.min(ah / 5.2, aw * 0.13) * this.zoom;
    const R = Math.min(aw * 0.31, (ah - gap * 3) / (2 * TILT * 1.42) * 0.9, gap * 2.5) * this.zoom;
    const yaw = this.yaw + this.dragYaw + (this.reduce ? 0 : Math.sin(this.clock * 0.07) * IDLE_SWAY);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, R: Math.max(40, R), gap: Math.max(26, gap), cos: Math.cos(yaw), sin: Math.sin(yaw) };
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  private draw() {
    const { ctx, model } = this;
    const g = this.frameGeometry();
    const planeY = (s: number) => g.cy + (s - 1.5) * g.gap;
    const project = (u: number, v: number, s: number): [number, number] => {
      const ru = u * g.cos - v * g.sin;
      const rv = u * g.sin + v * g.cos;
      return [g.cx + ru * g.R, planeY(s) + rv * g.R * TILT];
    };

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const anyFocus = this.focus.size > 0;
    const layerAlpha = (s: number) => (this.emphasis < 0 || this.emphasis === s ? 1 : 0.22);

    // Planes, bottom to top: a faint fill, an edge, and a sparse survey grid.
    for (let s = 3; s >= 0; s--) {
      const pig = this.pigments[s];
      const la = layerAlpha(s);
      const corners = [project(-1, -1, s), project(1, -1, s), project(1, 1, s), project(-1, 1, s)];
      ctx.beginPath();
      corners.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = rgba(pig, (this.emphasis === s ? 0.07 : 0.03) * la + 0.008);
      ctx.fill();
      ctx.strokeStyle = rgba(pig, (this.emphasis === s ? 0.5 : 0.2) * la + 0.04);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = rgba(this.ink, 0.035 * la);
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        const t = k / 3;
        const [ax, ay] = project(t, -1, s), [bx, by] = project(t, 1, s);
        const [cx2, cy2] = project(-1, t, s), [dx, dy] = project(1, t, s);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.moveTo(cx2, cy2); ctx.lineTo(dx, dy);
      }
      ctx.stroke();
    }

    // Screen positions for every node, reused by edges, nodes and hit-testing.
    for (let i = 0; i < model.nodeCount; i++) {
      const [x, y] = project(model.u[i], model.v[i], model.layer[i]);
      this.sx[i] = x;
      this.sy[i] = y;
    }

    // The context column: a plumb line from each focused agent down through
    // every stratum, marking where it pierces each plane.
    for (const i of this.focus) {
      if (model.layer[i] !== 0) continue;
      const u = model.u[i], v = model.v[i];
      const [tx, ty] = project(u, v, 0);
      const [bx, by] = project(u, v, 3);
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = rgba(this.brass, 0.55);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx, by + 10);
      ctx.stroke();
      ctx.restore();
      for (let s = 1; s < 4; s++) {
        const [px, py] = project(u, v, s);
        ctx.strokeStyle = rgba(this.brass, 0.35 * layerAlpha(s));
        ctx.beginPath();
        ctx.ellipse(px, py, 11, 11 * TILT, 0, 0, TAU);
        ctx.stroke();
      }
    }

    // Threads. Edges between strata are drawn as straight drops; edges within
    // a stratum lie on its plane. Both stay faint unless they touch focus.
    const E = model.edges;
    for (let k = 0; k < E.length; k += 2) {
      const a = E[k], b = E[k + 1];
      const hot = this.hover === a || this.hover === b || this.focus.has(a) || this.focus.has(b);
      const la = Math.min(layerAlpha(model.layer[a]), layerAlpha(model.layer[b]));
      let alpha = model.layer[a] === model.layer[b] ? 0.09 : 0.07;
      if (anyFocus && !hot) alpha *= 0.6;
      if (hot) alpha = 0.55;
      const rgb = hot ? this.brass : this.pigments[Math.max(model.layer[a], model.layer[b])];
      ctx.strokeStyle = rgba(rgb, alpha * la);
      ctx.lineWidth = hot ? 1.1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(this.sx[a], this.sy[a]);
      ctx.lineTo(this.sx[b], this.sy[b]);
      ctx.stroke();
    }

    // Nodes, deepest stratum first so upper strata sit visually in front.
    const breathe = this.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 2.2);
    ctx.font = this.font;
    ctx.textBaseline = "middle";
    // Labels never stack on each other: a name that would collide with one
    // already placed is left to the hover readout.
    const placed: Array<[number, number, number, number]> = [];
    const label = (text: string, x: number, y: number, alpha: number) => {
      const w = ctx.measureText(text).width;
      const box: [number, number, number, number] = [x - 2, y - 7, x + w + 2, y + 7];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      placed.push(box);
      ctx.fillStyle = rgba(this.ink, alpha);
      ctx.fillText(text, x, y);
    };
    for (let s = 3; s >= 0; s--) {
      const pig = this.pigments[s];
      const la = layerAlpha(s);
      for (let i = 0; i < model.nodeCount; i++) {
        if (model.layer[i] !== s) continue;
        const x = this.sx[i], y = this.sy[i];
        const focused = this.focus.has(i);
        const near = this.focusNeighbours.has(i) || this.hover === i;
        const heat = this.heat.get(i) ?? 0;
        const agent = this.agentByNode.get(i);
        const rgb = agent ? hexToRgb(agent.color) : pig;
        let alpha = anyFocus ? (focused || near ? 1 : 0.5) : 0.92;
        alpha = Math.min(1, alpha + heat * 0.5) * la;
        const r = (model.isHub[i] || agent ? 3.6 : 2.2) + (focused ? 1.2 : 0) + heat * 1.6;

        if (heat > 0.05 || focused) {
          ctx.fillStyle = rgba(focused ? this.brass : rgb, (0.1 + heat * 0.25) * la);
          ctx.beginPath();
          ctx.arc(x, y, r + 6 + heat * 6, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = rgba(rgb, alpha);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();

        if (focused) {
          ctx.strokeStyle = rgba(this.brass, 0.9 * la);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, r + 3.5, 0, TAU);
          ctx.stroke();
        }
        if (agent?.working) {
          ctx.strokeStyle = rgba(rgb, (0.25 + 0.5 * breathe) * la);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r + 5 + breathe * 3, 0, TAU);
          ctx.stroke();
        }
        // Agents are few and are who you talk to: they keep their names. So
        // does anything in focus, and the agent stratum when it is small.
        if (agent || focused || (s === 0 && model.counts[0] <= 14)) {
          label(agent?.name ?? model.labels[i], x + r + 6, y, (focused ? 0.92 : 0.62) * la);
        }
      }
    }

    // Event pulses: a bead running the thread from the agent to what it touched.
    for (const p of this.pulses) {
      const e = 1 - Math.pow(1 - p.t, 3);
      const x = this.sx[p.from] + (this.sx[p.to] - this.sx[p.from]) * e;
      const y = this.sy[p.from] + (this.sy[p.to] - this.sy[p.from]) * e;
      ctx.strokeStyle = rgba(p.rgb, 0.35 * (1 - p.t));
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(this.sx[p.from], this.sy[p.from]);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rgba(p.rgb, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
    }
    for (const r of this.ripples) {
      ctx.strokeStyle = rgba(r.rgb, 0.6 * (1 - r.t));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(this.sx[r.node], this.sy[r.node], 4 + r.t * 22, (4 + r.t * 22) * TILT * 1.6, 0, 0, TAU);
      ctx.stroke();
    }
  }

  // ── Pointer ─────────────────────────────────────────────────────────────

  private nearest(x: number, y: number) {
    let best = -1, bestD = 14 * 14;
    for (let i = 0; i < this.model.nodeCount; i++) {
      const dx = this.sx[i] - x, dy = this.sy[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  private bindPointer() {
    const c = this.canvas;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const down = (e: PointerEvent) => {
      this.dragging = true;
      this.moved = false;
      this.lastX = e.clientX;
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        if (Math.abs(dx) > 2) this.moved = true;
        this.lastX = e.clientX;
        this.dragYaw += dx * 0.006;
        this.kick();
        return;
      }
      const [x, y] = local(e);
      const i = this.nearest(x, y);
      if (i !== this.hover) {
        this.hover = i;
        c.style.cursor = i >= 0 ? "pointer" : "grab";
        this.opts.onHover?.(i >= 0 ? {
          label: this.model.labels[i], type: this.model.types[i], stratum: STRATA[this.model.layer[i]].label,
          x: this.sx[i], y: this.sy[i],
        } : null);
        this.kick();
      }
    };
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      c.releasePointerCapture(e.pointerId);
      if (this.moved) return;
      const [x, y] = local(e);
      const i = this.nearest(x, y);
      this.pinned = i >= 0 && i !== this.pinned ? i : -1;
      this.opts.onSelect?.(this.pinned >= 0 ? this.model.ids[this.pinned] : null);
      this.rebuildFocus();
      this.kick();
    };
    const leave = () => {
      if (this.hover !== -1) { this.hover = -1; this.opts.onHover?.(null); this.kick(); }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.08 : 0.93);
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("wheel", wheel, { passive: false });
    c.style.cursor = "grab";
    this.disposers.push(() => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("wheel", wheel);
    });
  }
}
