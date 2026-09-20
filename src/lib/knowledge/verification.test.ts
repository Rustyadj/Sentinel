import { describe, expect, it } from "vitest";
import { verificationNeed, verificationNotice } from "./verification";

const now = Date.UTC(2026, 8, 20);
const ago = (ms: number) => new Date(now - ms);
const MINUTE = 60_000;
const DAY = 86_400_000;

describe("verificationNeed", () => {
  it("leaves a stable fact alone however old it is", () => {
    const need = verificationNeed({ volatility: "stable", createdAt: ago(900 * DAY) }, now);
    expect(need.required).toBe(false);
  });

  it("flags a volatile fact within minutes", () => {
    expect(verificationNeed({ volatility: "volatile", createdAt: ago(5 * MINUTE) }, now).required).toBe(false);
    const stale = verificationNeed({ volatility: "volatile", createdAt: ago(60 * MINUTE) }, now);
    expect(stale.required).toBe(true);
    expect(stale.reason).toMatch(/may no longer be current/);
  });

  it("flags a slow-moving fact after weeks, not minutes", () => {
    expect(verificationNeed({ volatility: "slow", createdAt: ago(10 * DAY) }, now).required).toBe(false);
    expect(verificationNeed({ volatility: "slow", createdAt: ago(45 * DAY) }, now).required).toBe(true);
  });

  it("measures from the last verification when there has been one", () => {
    const need = verificationNeed(
      { volatility: "volatile", createdAt: ago(300 * DAY), lastVerifiedAt: ago(2 * MINUTE) },
      now,
    );
    expect(need.required).toBe(false);
  });

  it("always checks an on_read fact, however fresh", () => {
    const need = verificationNeed(
      { volatility: "volatile", verificationPolicy: "on_read", lastVerifiedAt: ago(1000), createdAt: ago(1000) },
      now,
    );
    expect(need.required).toBe(true);
  });

  it("treats an unknown volatility as stable rather than guessing", () => {
    expect(verificationNeed({ volatility: "nonsense", createdAt: ago(900 * DAY) }, now).required).toBe(false);
  });

  it("names where to check when a source is recorded", () => {
    const need = verificationNeed(
      { volatility: "volatile", createdAt: ago(DAY), authoritativeSource: "GET /api/health" },
      now,
    );
    expect(verificationNotice(need)).toContain("check GET /api/health");
    expect(verificationNotice({ ...need, required: false })).toBeNull();
  });
});
