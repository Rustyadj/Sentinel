import { describe, expect, it } from "vitest";
import { evaluateAuthority, grantRejection, operationForStep, periodStart, validateGrantShape, type AuthorityGrantLike, type AuthorityRequest } from "./authority";

const now = new Date("2026-11-27T12:00:00Z");

function grant(overrides: Partial<AuthorityGrantLike> = {}): AuthorityGrantLike {
  return {
    id: "g1", workspaceId: "ws1", projectId: null, agentId: null, roomId: null, objectiveId: null,
    operations: ["routine"], capabilities: [], runtimes: [], maxUses: null, usesCount: 0, budgetCents: null, spentCents: 0,
    period: null, periodMaxUses: null, periodStartedAt: null, periodUses: 0, startsAt: null, expiresAt: null, revokedAt: null,
    ...overrides,
  };
}
const req = (overrides: Partial<AuthorityRequest> = {}): AuthorityRequest => ({ workspaceId: "ws1", agentId: "codex", operation: "write", ...overrides });

describe("standing delegation matching", () => {
  it("a routine grant covers read/write/exec/delegate without another approval", () => {
    for (const operation of ["read", "write", "exec", "delegate"] as const) {
      expect(evaluateAuthority(req({ operation }), [grant()], now).authorized).toBe(true);
    }
  });

  it("routine never covers consequential operations; they must be named", () => {
    for (const operation of ["external", "deploy", "publish", "financial", "legal", "destructive", "credential"] as const) {
      const decision = evaluateAuthority(req({ operation }), [grant()], now);
      expect(decision.authorized, operation).toBe(false);
      expect(decision.missing).toContain(`"${operation}"`);
    }
    expect(evaluateAuthority(req({ operation: "deploy" }), [grant({ operations: ["deploy"] })], now).authorized).toBe(true);
  });

  it("absent authority is never permission, and the decision names what is missing", () => {
    const decision = evaluateAuthority(req({ operation: "deploy", projectId: "p1" }), [], now);
    expect(decision.authorized).toBe(false);
    expect(decision.missing).toMatch(/No standing authority covers "deploy" for agent codex.*project p1/);
  });

  it("tenant isolation: a grant in another workspace matches nothing", () => {
    expect(evaluateAuthority(req({ workspaceId: "ws2" }), [grant()], now).authorized).toBe(false);
    expect(grantRejection(grant(), req({ workspaceId: "ws2" }), now)).toBe("different workspace");
  });

  it("revoked, expired, and not-yet-active grants are enforced", () => {
    expect(grantRejection(grant({ revokedAt: new Date("2026-11-01") }), req(), now)).toBe("revoked");
    expect(grantRejection(grant({ expiresAt: new Date("2026-11-27T11:59:59Z") }), req(), now)).toBe("expired");
    expect(grantRejection(grant({ startsAt: new Date("2026-11-28") }), req(), now)).toBe("not yet active");
    expect(grantRejection(grant({ expiresAt: new Date("2026-11-28") }), req(), now)).toBeNull();
  });

  it("project/agent/room/objective narrowing is respected", () => {
    expect(grantRejection(grant({ projectId: "p1" }), req({ projectId: "p2" }), now)).toMatch(/project p1/);
    expect(grantRejection(grant({ agentId: "claude-code" }), req(), now)).toMatch(/agent claude-code/);
    expect(grantRejection(grant({ roomId: "r1" }), req(), now)).toMatch(/room r1/);
    expect(grantRejection(grant({ objectiveId: "o1" }), req({ objectiveId: "o1" }), now)).toBeNull();
  });

  it("capability- and runtime-limited grants cover only what they list", () => {
    const g = grant({ capabilities: ["backend", "testing"], runtimes: ["codex"] });
    expect(grantRejection(g, req({ capabilities: ["backend"], runtime: "codex" }), now)).toBeNull();
    expect(grantRejection(g, req({ capabilities: ["backend", "devops"], runtime: "codex" }), now)).toMatch(/devops/);
    expect(grantRejection(g, req({ capabilities: [], runtime: "codex" }), now)).toMatch(/declares none/);
    expect(grantRejection(g, req({ capabilities: ["backend"], runtime: "claude-code" }), now)).toMatch(/runtimes/);
  });

  it("use limits and recurring windows are enforced", () => {
    expect(grantRejection(grant({ maxUses: 3, usesCount: 3 }), req(), now)).toBe("use limit reached");
    const today = periodStart("day", now);
    expect(grantRejection(grant({ period: "day", periodMaxUses: 2, periodStartedAt: today, periodUses: 2 }), req(), now)).toMatch(/day use limit/);
    // Yesterday's window doesn't count against today.
    expect(grantRejection(grant({ period: "day", periodMaxUses: 2, periodStartedAt: new Date(today.getTime() - 86_400_000), periodUses: 2 }), req(), now)).toBeNull();
    expect(periodStart("week", now).toISOString()).toBe("2026-11-23T00:00:00.000Z"); // Monday
  });

  it("financial authority needs an explicit budget, and spending never exceeds it", () => {
    expect(grantRejection(grant({ operations: ["financial"] }), req({ operation: "financial", costCents: 100 }), now)).toMatch(/explicit budget/);
    const funded = grant({ operations: ["financial"], budgetCents: 1_000, spentCents: 900 });
    expect(grantRejection(funded, req({ operation: "financial", costCents: 100 }), now)).toBeNull();
    expect(grantRejection(funded, req({ operation: "financial", costCents: 101 }), now)).toMatch(/budget exhausted/);
    // A routine grant without a budget can't pay for anything.
    expect(grantRejection(grant(), req({ costCents: 5 }), now)).toMatch(/no budget/);
  });

  it("the most specific matching grant is the one used", () => {
    const broad = grant({ id: "broad" });
    const narrow = grant({ id: "narrow", agentId: "codex", projectId: "p1" });
    expect(evaluateAuthority(req({ projectId: "p1" }), [broad, narrow], now).grant?.id).toBe("narrow");
  });

  it("maps objective steps onto operations", () => {
    expect(operationForStep("write", "agent")).toBe("delegate");
    expect(operationForStep("publish", "tool")).toBe("publish");
    expect(operationForStep("read", "tool")).toBe("read");
  });

  it("validates grant shape at the boundary", () => {
    const base = { operations: ["routine"], budgetCents: null, period: null, periodMaxUses: null, expiresAt: null, startsAt: null };
    expect(validateGrantShape(base).ok).toBe(true);
    expect(validateGrantShape({ ...base, operations: [] }).ok).toBe(false);
    expect(validateGrantShape({ ...base, operations: ["everything"] }).errors[0]).toMatch(/unknown operation/);
    expect(validateGrantShape({ ...base, operations: ["financial"] }).errors[0]).toMatch(/budget/);
    expect(validateGrantShape({ ...base, period: "day" }).ok).toBe(false);
  });
});
