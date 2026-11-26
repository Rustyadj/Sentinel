import { describe, expect, it } from "vitest";
import { breath, BREATH, DRIFT_PX, driftOffset, driftSeed, springDecay, SPRING_HALF_LIFE } from "./watch-motion";

describe("the watch's ambient motion", () => {
  it("never takes a node further from its seat than the drift amplitude", () => {
    for (const id of ["lisa", "nathan2", "project:titan", "memory:42"]) {
      const seed = driftSeed(id);
      for (let t = 0; t < 600; t += 0.37) {
        const [dx, dy] = driftOffset(seed, t, DRIFT_PX);
        expect(Math.abs(dx)).toBeLessThanOrEqual(DRIFT_PX + 1e-9);
        expect(Math.abs(dy)).toBeLessThanOrEqual(DRIFT_PX + 1e-9);
      }
    }
  });

  it("moves the same node the same way every time, and different nodes differently", () => {
    expect(driftOffset(driftSeed("a"), 12.5, DRIFT_PX)).toEqual(driftOffset(driftSeed("a"), 12.5, DRIFT_PX));
    expect(driftOffset(driftSeed("a"), 12.5, DRIFT_PX)).not.toEqual(driftOffset(driftSeed("b"), 12.5, DRIFT_PX));
  });

  it("is slow: a node travels less than a pixel in a tenth of a second", () => {
    const seed = driftSeed("slow");
    for (let t = 0; t < 120; t += 1.3) {
      const [ax, ay] = driftOffset(seed, t, DRIFT_PX);
      const [bx, by] = driftOffset(seed, t + 0.1, DRIFT_PX);
      expect(Math.hypot(bx - ax, by - ay)).toBeLessThan(1);
    }
  });

  it("stands still when drift is off", () => {
    expect(driftOffset(driftSeed("x"), 99, 0)).toEqual([0, 0]);
  });

  it("breathes within its bound", () => {
    for (let t = 0; t < 60; t += 0.5) expect(Math.abs(breath(t) - 1)).toBeLessThanOrEqual(BREATH + 1e-9);
  });

  it("returns a released node halfway home in one half-life", () => {
    expect(springDecay(SPRING_HALF_LIFE)).toBeCloseTo(0.5, 6);
    expect(springDecay(0)).toBe(1);
  });
});
