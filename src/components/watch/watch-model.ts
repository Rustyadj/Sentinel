// Lays the knowledge graph out as a watch: agents at the centre, and around
// them the rings of what they work for, the work itself, and what is known.
// A node leans toward the things nearer the centre that it is connected to,
// so a project sits out from its agents and a task out from its project, and
// the lines between rings run roughly along a radius.
//
// Positions are a pure function of the graph and of where the agents stand.
// The same graph always draws the same picture; nothing is placed to fill space.

import type { StrataModel } from "@/components/strata/strata-model";

const TAU = Math.PI * 2;

/** Radius of each ring as a fraction of the chart radius: agents' company, projects, tasks, memory. */
export const RING_RADIUS = [0.34, 0.53, 0.74, 0.95] as const;
/** Where the agents themselves stand. */
export const LIGHT_RADIUS = 0.17;
const BAND = [0.035, 0.055, 0.065, 0.06];

export interface WatchLayout {
  /** Position of each node in chart units: the chart is the unit disc. */
  x: Float32Array;
  y: Float32Array;
  /** Node index standing at each agent's light, or -1 when that agent has no node in the graph. */
  lightNode: Int32Array;
  /** Where each agent stands, in chart units. */
  lightX: Float32Array;
  lightY: Float32Array;
}

function hash(text: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const unit = (h: number) => (h % 100000) / 100000;

/** Agents stand evenly around the centre, the first at twelve o'clock. A lone agent stands at the centre itself. */
export function lightAngle(index: number, count: number): number {
  return -Math.PI / 2 + (index / Math.max(count, 1)) * TAU;
}

/**
 * Spreads angles that landed too close together on one ring. Order around
 * the ring is kept, so a node stays near what it leans toward.
 */
function spread(angles: Array<{ node: number; angle: number }>, minGap: number) {
  const count = angles.length;
  if (count < 2) return;
  angles.sort((a, b) => a.angle - b.angle);
  const gap = Math.min(minGap, TAU / count);

  // One sweep opens every gap; it only ever pushes forward, so the whole
  // ring is then turned back by the average push to stay where it leaned.
  const before = angles.map((entry) => entry.angle);
  for (let i = 1; i < count; i++) {
    if (angles[i].angle - angles[i - 1].angle < gap) angles[i].angle = angles[i - 1].angle + gap;
  }
  let drift = 0;
  for (let i = 0; i < count; i++) drift += angles[i].angle - before[i];
  drift /= count;
  for (const entry of angles) entry.angle -= drift;

  // If the ring is now longer than a full turn, there is no room to lean: space it evenly.
  const span = angles[count - 1].angle - angles[0].angle;
  if (span > TAU - gap) {
    const start = angles[0].angle;
    for (let i = 0; i < count; i++) angles[i].angle = start + (i / count) * TAU;
  }
}

export function layoutWatch(model: StrataModel, agentNodeIds: Array<string | null>): WatchLayout {
  const n = model.nodeCount;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const angle = new Float32Array(n);
  const placed = new Uint8Array(n);

  const lights = agentNodeIds.length;
  const lightNode = new Int32Array(lights).fill(-1);
  const lightX = new Float32Array(lights);
  const lightY = new Float32Array(lights);
  const radius = lights === 1 ? 0 : LIGHT_RADIUS;

  for (let i = 0; i < lights; i++) {
    const a = lightAngle(i, lights);
    lightX[i] = Math.cos(a) * radius;
    lightY[i] = Math.sin(a) * radius;
    const id = agentNodeIds[i];
    const node = id ? model.indexById.get(id) ?? -1 : -1;
    if (node < 0 || placed[node]) continue;
    lightNode[i] = node;
    x[node] = lightX[i];
    y[node] = lightY[i];
    angle[node] = a;
    placed[node] = 1;
  }

  for (let ring = 0; ring < 4; ring++) {
    const members: Array<{ node: number; angle: number }> = [];
    for (let i = 0; i < n; i++) {
      if (model.layer[i] !== ring || placed[i]) continue;
      // Circular mean of everything nearer the centre that this node touches.
      let sx = 0, sy = 0, k = 0;
      for (const j of model.adjacency[i]) {
        if (placed[j] && (model.layer[j] < ring || lightNode.includes(j))) { sx += Math.cos(angle[j]); sy += Math.sin(angle[j]); k++; }
      }
      const id = model.ids[i];
      const lean = k && Math.hypot(sx, sy) > 1e-3
        ? Math.atan2(sy, sx) + (unit(hash(id, 977)) - 0.5) * 0.5
        : unit(hash(id)) * TAU;
      members.push({ node: i, angle: lean });
    }
    // Wider gaps on the inner rings, where there is less room and fewer nodes.
    spread(members, [0.34, 0.2, 0.09, 0.05][ring]);
    for (const { node, angle: a } of members) {
      const r = RING_RADIUS[ring] + (unit(hash(model.ids[node], 40503)) - 0.5) * 2 * BAND[ring];
      angle[node] = a;
      x[node] = Math.cos(a) * r;
      y[node] = Math.sin(a) * r;
      placed[node] = 1;
    }
  }

  return { x, y, lightNode, lightX, lightY };
}
