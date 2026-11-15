// Canvas renderer for the watch: the knowledge graph as rings around the
// agents, with each agent's attention drawn as a beam onto what it is
// touching. It owns projection, camera and drawing, and knows nothing about
// React or how Sentinel fetches data.
//
// Nothing here is invented. A node is drawn only if the model has it, a beam
// is cast only when `dispatch` reports a real event, and an agent's light
// turns only while the caller says that agent is working.

import { STRATA, type StrataModel } from "@/components/strata/strata-model";
import { layoutWatch, RING_RADIUS, type WatchLayout } from "./watch-model";

type RGB = readonly [number, number, number];

const TAU = Math.PI * 2;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
/** How long a beam stays after the event that cast it, in seconds. */
const BEAM_HALF_LIFE = 7;
const HEAT_HALF_LIFE = 14;
const RIPPLE_SECONDS = 1.4;
const SWEEP_TURNS_PER_SECOND = 0.22;

export interface WatchAgent {
  id: string;
  name: string;
  color: string;
  working: boolean;
  /** KnowledgeObject id of the agent's own graph node, when it has one. */
  nodeId: string | null;
}

export interface WatchInsets { left: number; right: number; top: number; bottom: number }

export interface WatchHover {
  label: string;
  type: string;
  ring: string;
  x: number;
  y: number;
}

export interface WatchOptions {
  /** Screen regions covered by foreground UI; the chart centres in what is left. */
  insets: () => WatchInsets;
  onHover?: (hover: WatchHover | null) => void;
  onSelect?: (nodeId: string | null) => void;
  /** An agent's light was clicked. */
  onAgent?: (agentId: string) => void;
  /** Where each agent's light is on screen, so its caption can be placed in the DOM. */
  placeLight?: (agentId: string, x: number, y: number, outward: number) => void;
}

interface Beam { light: number; node: number; strength: number; phase: number }
interface Ripple { x: number; y: number; t: number; rgb: RGB }

const EMPTY: StrataModel = {
  nodeCount: 0, edgeCount: 0, ids: [], labels: [], types: [],
  layer: new Uint8Array(0), u: new Float32Array(0), v: new Float32Array(0), isHub: new Uint8Array(0),
  edges: new Uint32Array(0), adjacency: [], indexById: new Map(), counts: [0, 0, 0, 0],
};

function toRgb(color: string, fallback: RGB = [143, 164, 255]): RGB {
  const clean = color.trim().replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-f]{6}/i.test(full)) return fallback;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;

export class WatchRenderer {
  private model: StrataModel = EMPTY;
  private layout: WatchLayout = layoutWatch(EMPTY, []);
  private ctx: CanvasRenderingContext2D;
  private agents: WatchAgent[] = [];
  private agentRgb: RGB[] = [];
  private lightByAgent = new Map<string, number>();
  private focus = new Set<number>();
  private focusIds: string[] = [];
  private pinned = -1;
  private pinnedNeighbours = new Set<number>();
  private follow: string | null = null;
  private emphasis = -1;
  private heat = new Map<number, number>();
  private heatRgb = new Map<number, RGB>();
  private beams: Beam[] = [];
  private ripples: Ripple[] = [];
  private pigments: RGB[];
  private signal: RGB;
  private ink: RGB;
  private ground: RGB;
  private w = 0;
  private h = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private dirty = true;
  private reduce: boolean;
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private hover = -1;
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private lx = new Float32Array(0);
  private ly = new Float32Array(0);
  private ro: ResizeObserver;
  private disposers: Array<() => void> = [];
  private font: string;

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement, private opts: WatchOptions) {
    this.ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(host);
    const read = (token: string, fallback: string) => toRgb(css.getPropertyValue(token) || fallback, toRgb(fallback));
    this.pigments = STRATA.map((s) => read(s.token, s.hex));
    this.signal = read("--primary", "#ffd23f");
    this.ink = read("--foreground", "#eef0fa");
    this.ground = read("--canvas", "#080b19");
    this.font = css.fontFamily || "sans-serif";

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduce = motion.matches;
    const onMotion = () => { this.reduce = motion.matches; this.kick(); };
    motion.addEventListener("change", onMotion);
    this.disposers.push(() => motion.removeEventListener("change", onMotion));

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
    this.heatRgb.clear();
    this.beams = [];
    this.hover = -1;
    this.relayout();
    // Pin and focus are held by id, so they survive a refresh that keeps the node.
    this.setFocus(this.focusIds);
    this.pinned = -1;
    this.pinnedNeighbours.clear();
    this.opts.onSelect?.(null);
  }

  setAgents(agents: WatchAgent[]) {
    const moved = agents.length !== this.agents.length || agents.some((a, i) => a.id !== this.agents[i]?.id || a.nodeId !== this.agents[i]?.nodeId);
    this.agents = agents;
    this.agentRgb = agents.map((a) => toRgb(a.color));
    this.lightByAgent = new Map(agents.map((a, i) => [a.id, i]));
    if (moved) {
      this.lx = new Float32Array(agents.length);
      this.ly = new Float32Array(agents.length);
      this.beams = [];
      this.relayout();
    }
    this.kick();
  }

  setFocus(ids: string[]) {
    this.focusIds = ids;
    this.focus = new Set(ids.map((id) => this.model.indexById.get(id) ?? -1).filter((i) => i >= 0));
    this.kick();
  }

  setFollow(agentId: string | null) { this.follow = agentId; this.kick(); }
  setEmphasis(ring: number) { this.emphasis = ring; this.kick(); }

  /** A real event: `agentId` touched `nodeIds`. Casts a beam to each one the graph holds. */
  dispatch(agentId: string, nodeIds: string[]) {
    const light = this.lightByAgent.get(agentId);
    if (light === undefined) return;
    const rgb = this.agentRgb[light];
    let cast = 0;
    for (const id of nodeIds) {
      const node = this.model.indexById.get(id);
      if (node === undefined || node === this.layout.lightNode[light]) continue;
      const existing = this.beams.find((b) => b.light === light && b.node === node);
      if (existing) existing.strength = 1;
      else this.beams.push({ light, node, strength: 1, phase: this.clock });
      this.heat.set(node, 1);
      this.heatRgb.set(node, rgb);
      this.ripples.push({ x: this.layout.x[node], y: this.layout.y[node], t: 0, rgb });
      cast++;
    }
    // An act that touched nothing the graph holds still happened: the light itself answers.
    if (!cast) this.ripples.push({ x: this.layout.lightX[light], y: this.layout.lightY[light], t: 0, rgb });
    this.kick();
  }

  zoomBy(factor: number) { this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor)); this.kick(); }
  reset() { this.zoom = 1; this.panX = 0; this.panY = 0; this.clearPin(); this.kick(); }
  clearPin() { this.pinned = -1; this.pinnedNeighbours.clear(); this.kick(); }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const dispose of this.disposers) dispose();
  }

  // ── Layout and camera ───────────────────────────────────────────────────

  private relayout() {
    this.layout = layoutWatch(this.model, this.agents.map((a) => a.nodeId));
    this.kick();
  }

  private resize() {
    const rect = this.host.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.kick();
  }

  private frame() {
    const inset = this.opts.insets();
    const fw = Math.max(40, this.w - inset.left - inset.right);
    const fh = Math.max(40, this.h - inset.top - inset.bottom);
    return {
      cx: inset.left + fw / 2 + this.panX,
      cy: inset.top + fh / 2 + this.panY,
      // Room for the captions that hang outside the outer ring.
      radius: (Math.min(fw, fh) / 2) * 0.86 * this.zoom,
    };
  }

  private kick() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private get moving() {
    return this.beams.length > 0 || this.ripples.length > 0 || this.heat.size > 0 || (!this.reduce && this.agents.some((a) => a.working));
  }

  private tick(time: number) {
    this.raf = 0;
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.1, (time - this.last) / 1000) : 0;
    this.last = time;
    this.clock += dt;

    if (dt > 0) {
      const beamDecay = Math.pow(0.5, dt / BEAM_HALF_LIFE);
      const heatDecay = Math.pow(0.5, dt / HEAT_HALF_LIFE);
      // A beam holds full strength for as long as its agent is still working.
      for (const beam of this.beams) if (!this.agents[beam.light]?.working) beam.strength *= beamDecay; else beam.strength = Math.max(beam.strength * Math.pow(0.5, dt / (BEAM_HALF_LIFE * 4)), 0.35);
      this.beams = this.beams.filter((b) => b.strength > 0.04 && b.light < this.agents.length);
      for (const [node, value] of this.heat) {
        const next = value * heatDecay;
        if (next < 0.03) { this.heat.delete(node); this.heatRgb.delete(node); } else this.heat.set(node, next);
      }
      for (const ripple of this.ripples) ripple.t += dt / RIPPLE_SECONDS;
      this.ripples = this.ripples.filter((r) => r.t < 1);
    }

    if (this.dirty || this.moving) { this.draw(); this.dirty = false; }
    if (this.moving) this.raf = requestAnimationFrame((t) => this.tick(t));
    else this.last = 0;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  private draw() {
    const { ctx, model, layout } = this;
    const { cx, cy, radius } = this.frame();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    for (let i = 0; i < model.nodeCount; i++) {
      this.sx[i] = cx + layout.x[i] * radius;
      this.sy[i] = cy + layout.y[i] * radius;
    }
    for (let i = 0; i < this.agents.length; i++) {
      this.lx[i] = cx + layout.lightX[i] * radius;
      this.ly[i] = cy + layout.lightY[i] * radius;
    }

    this.drawRings(cx, cy, radius);
    this.drawEdges();
    this.drawBeams();
    this.drawRipples(cx, cy, radius);
    this.drawNodes();
    this.drawLights(cx, cy);
    this.drawLabels();
  }

  private drawRings(cx: number, cy: number, radius: number) {
    const { ctx } = this;
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 4; ring++) {
      const on = this.emphasis === ring;
      ctx.beginPath();
      ctx.arc(cx, cy, RING_RADIUS[ring] * radius, 0, TAU);
      ctx.strokeStyle = on ? rgba(this.pigments[ring], 0.55) : rgba(this.ink, 0.12);
      ctx.setLineDash(on ? [] : [2, 7]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private nodeAlpha(i: number): number {
    if (this.pinned >= 0) return i === this.pinned || this.pinnedNeighbours.has(i) ? 1 : 0.16;
    if (this.emphasis >= 0) return this.model.layer[i] === this.emphasis ? 1 : 0.18;
    return 0.78;
  }

  private drawEdges() {
    const { ctx, model } = this;
    const lit = this.pinned >= 0 ? this.pinned : this.hover;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let e = 0; e < model.edges.length; e += 2) {
      const a = model.edges[e], b = model.edges[e + 1];
      if (a === lit || b === lit) continue;
      ctx.moveTo(this.sx[a], this.sy[a]);
      ctx.lineTo(this.sx[b], this.sy[b]);
    }
    ctx.strokeStyle = rgba(this.ink, this.pinned >= 0 || this.emphasis >= 0 ? 0.03 : 0.06);
    ctx.stroke();

    if (lit >= 0) {
      ctx.beginPath();
      for (const j of model.adjacency[lit] ?? []) {
        ctx.moveTo(this.sx[lit], this.sy[lit]);
        ctx.lineTo(this.sx[j], this.sy[j]);
      }
      ctx.strokeStyle = rgba(this.pigments[model.layer[lit]], 0.6);
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  }

  /** An agent's attention: a wedge of its own colour from its light onto the node it is touching. */
  private drawBeams() {
    const { ctx } = this;
    for (const beam of this.beams) {
      const agent = this.agents[beam.light];
      if (!agent) continue;
      const rgb = this.agentRgb[beam.light];
      const dimmed = this.follow && this.follow !== agent.id ? 0.25 : 1;
      const s = beam.strength * dimmed;
      const ax = this.lx[beam.light], ay = this.ly[beam.light];
      const bx = this.sx[beam.node], by = this.sy[beam.node];
      const dx = bx - ax, dy = by - ay;
      const length = Math.hypot(dx, dy);
      if (length < 2) continue;
      const nx = -dy / length, ny = dx / length;
      const spread = 5 + length * 0.07;

      const fill = ctx.createLinearGradient(ax, ay, bx, by);
      fill.addColorStop(0, rgba(rgb, 0.34 * s));
      fill.addColorStop(1, rgba(rgb, 0.07 * s));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx + nx * spread, by + ny * spread);
      ctx.lineTo(bx - nx * spread, by - ny * spread);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = rgba(rgb, 0.75 * s);
      ctx.lineWidth = 1.25;
      ctx.stroke();

      // Something travelling out along the beam says the agent is still at it.
      if (agent.working && !this.reduce) {
        const t = ((this.clock - beam.phase) * 0.7) % 1;
        ctx.beginPath();
        ctx.arc(ax + dx * t, ay + dy * t, 2.2, 0, TAU);
        ctx.fillStyle = rgba(rgb, 0.95 * dimmed);
        ctx.fill();
      }
    }
  }

  private drawRipples(cx: number, cy: number, radius: number) {
    const { ctx } = this;
    for (const ripple of this.ripples) {
      const ease = 1 - Math.pow(1 - ripple.t, 3);
      ctx.beginPath();
      ctx.arc(cx + ripple.x * radius, cy + ripple.y * radius, 5 + ease * 22, 0, TAU);
      ctx.strokeStyle = rgba(ripple.rgb, (1 - ripple.t) * 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private nodeRadius(i: number): number {
    const scale = Math.sqrt(Math.max(this.zoom, 0.7));
    return (this.model.isHub[i] ? 4.6 : 2.7) * scale;
  }

  private drawNodes() {
    const { ctx, model } = this;
    const bound = new Set<number>(this.layout.lightNode);
    for (let i = 0; i < model.nodeCount; i++) {
      if (bound.has(i)) continue; // drawn as that agent's light
      const pigment = this.pigments[model.layer[i]];
      const alpha = this.nodeAlpha(i);
      const r = this.nodeRadius(i);
      const heat = this.heat.get(i) ?? 0;
      const x = this.sx[i], y = this.sy[i];

      if (heat > 0.03) {
        const rgb = this.heatRgb.get(i) ?? pigment;
        ctx.beginPath();
        ctx.arc(x, y, r + 3 + heat * 5, 0, TAU);
        ctx.fillStyle = rgba(rgb, 0.22 * heat);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, TAU);
        ctx.strokeStyle = rgba(rgb, 0.9 * heat);
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = rgba(pigment, alpha);
      ctx.fill();

      if (this.focus.has(i) || i === this.pinned) {
        ctx.beginPath();
        ctx.arc(x, y, r + (i === this.pinned ? 5 : 3.5), 0, TAU);
        ctx.strokeStyle = rgba(this.signal, i === this.pinned ? 1 : 0.8);
        ctx.lineWidth = i === this.pinned ? 2 : 1.25;
        ctx.stroke();
      }
    }
  }

  private drawLights(cx: number, cy: number) {
    const { ctx } = this;
    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      const rgb = this.agentRgb[i];
      const x = this.lx[i], y = this.ly[i];
      const dimmed = this.follow && this.follow !== agent.id ? 0.4 : 1;

      if (agent.working) {
        // The lamp turning: a short wedge of light sweeping round the agent.
        const turn = this.reduce ? -Math.PI / 2 : this.clock * SWEEP_TURNS_PER_SECOND * TAU + i * 1.7;
        const reach = 30;
        const glow = ctx.createRadialGradient(x, y, 6, x, y, reach);
        glow.addColorStop(0, rgba(rgb, 0.5 * dimmed));
        glow.addColorStop(1, rgba(rgb, 0));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, reach, turn - 0.42, turn + 0.42);
        ctx.closePath();
        ctx.fillStyle = glow;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, TAU);
        ctx.strokeStyle = rgba(rgb, 0.55 * dimmed);
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      // A ring of ground colour first, so beams and edges stop short of the lamp.
      ctx.beginPath();
      ctx.arc(x, y, 10.5, 0, TAU);
      ctx.fillStyle = rgba(this.ground, 1);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, TAU);
      ctx.fillStyle = rgba(rgb, (agent.working ? 1 : 0.5) * dimmed);
      ctx.fill();

      if (this.follow === agent.id) {
        ctx.beginPath();
        ctx.arc(x, y, 16.5, 0, TAU);
        ctx.strokeStyle = rgba(this.signal, 1);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Captions hang on the side of the light facing away from the centre.
      this.opts.placeLight?.(agent.id, x, y, Math.atan2(y - cy, x - cx));
    }
  }

  private drawLabels() {
    const { ctx, model } = this;
    const wanted = new Set<number>();
    if (this.hover >= 0) wanted.add(this.hover);
    if (this.pinned >= 0) { wanted.add(this.pinned); for (const j of [...this.pinnedNeighbours].slice(0, 14)) wanted.add(j); }
    for (const beam of this.beams) if (beam.strength > 0.3) wanted.add(beam.node);
    if (this.zoom >= 1.6) for (let i = 0; i < model.nodeCount; i++) if (model.isHub[i]) wanted.add(i);

    ctx.font = `500 11px ${this.font}`;
    ctx.textBaseline = "middle";
    const bound = new Set<number>(this.layout.lightNode);
    for (const i of wanted) {
      if (bound.has(i)) continue;
      const raw = model.labels[i] ?? "";
      const text = raw.length > 34 ? `${raw.slice(0, 33)}…` : raw;
      if (!text) continue;
      const width = ctx.measureText(text).width;
      const r = this.nodeRadius(i);
      // Flip to the left of the node when the label would leave the canvas.
      const right = this.sx[i] + r + 8 + width + 8 < this.w;
      const x = right ? this.sx[i] + r + 8 : this.sx[i] - r - 8 - width;
      const y = this.sy[i];
      ctx.fillStyle = rgba(this.ground, 0.9);
      ctx.fillRect(x - 4, y - 9, width + 8, 18);
      ctx.fillStyle = rgba(this.ink, i === this.hover || i === this.pinned ? 1 : 0.82);
      ctx.fillText(text, x, y);
    }
  }

  // ── Pointer ─────────────────────────────────────────────────────────────

  private pick(x: number, y: number): { node: number; light: number } {
    for (let i = 0; i < this.agents.length; i++) {
      if (Math.hypot(this.lx[i] - x, this.ly[i] - y) <= 15) return { node: -1, light: i };
    }
    let best = -1, bestDistance = 11;
    for (let i = 0; i < this.model.nodeCount; i++) {
      const d = Math.hypot(this.sx[i] - x, this.sy[i] - y);
      if (d < bestDistance) { best = i; bestDistance = d; }
    }
    return { node: best, light: -1 };
  }

  private bindPointer() {
    const el = this.canvas;
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const down = (e: PointerEvent) => {
      this.dragging = true; this.moved = false; this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (this.dragging) {
        const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
        this.panX += dx; this.panY += dy; this.lastX = e.clientX; this.lastY = e.clientY;
        this.kick();
        return;
      }
      const { x, y } = local(e);
      const hit = this.pick(x, y);
      el.style.cursor = hit.node >= 0 || hit.light >= 0 ? "pointer" : "grab";
      if (hit.node === this.hover) return;
      this.hover = hit.node;
      this.opts.onHover?.(hit.node >= 0 ? {
        label: this.model.labels[hit.node], type: this.model.types[hit.node],
        ring: STRATA[this.model.layer[hit.node]].label, x: this.sx[hit.node], y: this.sy[hit.node],
      } : null);
      this.kick();
    };
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (this.moved) return;
      const { x, y } = local(e);
      const hit = this.pick(x, y);
      if (hit.light >= 0) { this.opts.onAgent?.(this.agents[hit.light].id); return; }
      this.pinned = hit.node === this.pinned ? -1 : hit.node;
      this.pinnedNeighbours = new Set(this.pinned >= 0 ? this.model.adjacency[this.pinned] : []);
      this.opts.onSelect?.(this.pinned >= 0 ? this.model.ids[this.pinned] : null);
      this.kick();
    };
    const leave = () => { if (this.hover >= 0) { this.hover = -1; this.opts.onHover?.(null); this.kick(); } };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.1 : 0.91);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, { passive: false });
    this.disposers.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
    });
  }
}
