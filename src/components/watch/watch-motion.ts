// Ambient motion for the watch: a slow, bounded drift of every node around
// its seat, a faint breath of the whole chart, and the spring that returns a
// node someone has dragged.
//
// None of this is information. The seat (watch-model) never moves, so spatial
// memory holds; drift is a few pixels around it, far too small and too slow
// to be mistaken for a beam, a ripple or a turning light, which stay the only
// signs that an agent did something. Everything here is a pure function of
// time and a node's id, so the same node always moves the same way.

const TAU = Math.PI * 2;

/** Largest distance, in screen pixels, a node strays from its seat. */
export const DRIFT_PX = 4.5;
/** Agents' lights drift less than what surrounds them: they are the anchor. */
export const LIGHT_DRIFT_PX = 2;
/** How far the chart breathes, as a fraction of its radius, and how slowly. */
export const BREATH = 0.006;
export const BREATH_SECONDS = 18;
/** How strongly a node's neighbours follow it while it is dragged. */
export const DRAG_FOLLOW = 0.22;
/** Half-life, in seconds, of a released node's way back to its seat. */
export const SPRING_HALF_LIFE = 0.35;

export interface DriftSeed { w1: number; w2: number; p1: number; p2: number; p3: number; p4: number }

/** FNV-1a, so a node's motion is fixed by its id. */
function hash(text: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const unit = (h: number) => (h % 100000) / 100000;

export function driftSeed(id: string): DriftSeed {
  return {
    // A slow wander of 24–60 s with a quicker 11–25 s tremor laid over it.
    w1: TAU / (24 + unit(hash(id, 11)) * 36),
    w2: TAU / (11 + unit(hash(id, 23)) * 14),
    p1: unit(hash(id, 37)) * TAU,
    p2: unit(hash(id, 41)) * TAU,
    p3: unit(hash(id, 53)) * TAU,
    p4: unit(hash(id, 67)) * TAU,
  };
}

/** Offset from the seat at time `t`, never more than `amplitude` on either axis. */
export function driftOffset(seed: DriftSeed, t: number, amplitude: number): [number, number] {
  if (amplitude <= 0) return [0, 0];
  const dx = (Math.sin(t * seed.w1 + seed.p1) + 0.6 * Math.sin(t * seed.w2 + seed.p2)) / 1.6;
  const dy = (Math.cos(t * seed.w1 * 0.9 + seed.p3) + 0.6 * Math.sin(t * seed.w2 * 1.1 + seed.p4)) / 1.6;
  return [dx * amplitude, dy * amplitude];
}

/** Scale applied to the chart radius at time `t`. */
export function breath(t: number): number {
  return 1 + BREATH * Math.sin((TAU * t) / BREATH_SECONDS);
}

/** What is left of a released node's displacement after `dt` seconds. */
export function springDecay(dt: number): number {
  return Math.pow(0.5, dt / SPRING_HALF_LIFE);
}
