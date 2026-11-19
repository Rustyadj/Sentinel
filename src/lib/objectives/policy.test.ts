import { describe, expect, it } from "vitest";
import { allowedAttempts, decideStep, retryDelayMs } from "./policy";
import { assertValidPlan, businessSetupPlan, normalizeDomain, planObjective } from "./planner";
import { WORKFORCE_ROLES, roleAllowsTool } from "./roles";
import type { AutonomyLevel, StepImpact } from "./types";

const base = { kind: "tool" as const, estimatedCostCents: 0, spentCents: 0, budgetCents: 0 };

describe("autonomy policy", () => {
  it("reads always execute, at every level", () => {
    for (const level of [1, 2, 3, 4] as AutonomyLevel[]) expect(decideStep({ ...base, level, impact: "read" }).action).toBe("execute");
  });

  it("financial, legal, destructive and credential actions need approval even at level 4", () => {
    for (const impact of ["financial", "legal", "destructive", "credential"] as StepImpact[]) {
      expect(decideStep({ ...base, level: 4, impact, budgetCents: 1_000_000 }).action).toBe("approve");
    }
  });

  it("advisory mode never executes a non-read step", () => {
    for (const impact of ["write", "publish", "financial"] as StepImpact[]) expect(decideStep({ ...base, level: 1, impact }).action).toBe("advise");
  });

  it("supervised approves each write; managed runs writes but gates publishing and delegation; delegated runs both", () => {
    expect(decideStep({ ...base, level: 2, impact: "write" }).action).toBe("approve");
    expect(decideStep({ ...base, level: 3, impact: "write" }).action).toBe("execute");
    expect(decideStep({ ...base, level: 3, impact: "publish" }).action).toBe("approve");
    expect(decideStep({ ...base, level: 3, impact: "write", kind: "agent" }).action).toBe("approve");
    expect(decideStep({ ...base, level: 4, impact: "publish" }).action).toBe("execute");
    expect(decideStep({ ...base, level: 4, impact: "write", kind: "agent" }).action).toBe("execute");
  });

  it("spend past the budget needs approval even for an otherwise autonomous step", () => {
    expect(decideStep({ ...base, level: 4, impact: "write", estimatedCostCents: 500, spentCents: 900, budgetCents: 1000 }).action).toBe("approve");
    expect(decideStep({ ...base, level: 4, impact: "write", estimatedCostCents: 100, spentCents: 900, budgetCents: 1000 }).action).toBe("execute");
  });

  it("retries scale with autonomy and back off", () => {
    expect(allowedAttempts(2, 5)).toBe(1);
    expect(allowedAttempts(3, 5)).toBe(2);
    expect(allowedAttempts(4, 5)).toBe(5);
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(30)).toBe(15 * 60_000);
  });
});

describe("planner", () => {
  it("interprets the example goal and derives a domain when none is given", () => {
    const result = planObjective({ goal: "Create a new business called Titan Marketing. Register a domain, configure business email, build a website, establish a CRM." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.inputs).toMatchObject({ businessName: "Titan Marketing", domains: ["titanmarketing.com"] });
    expect(() => assertValidPlan(result.plan)).not.toThrow();
  });

  it("uses domains named in the goal instead of deriving one", () => {
    const result = planObjective({ goal: "Set up a business named Acme Labs on acmelabs.io" });
    expect(result.ok && result.plan.inputs.domains).toEqual(["acmelabs.io"]);
  });

  it("asks only for what is missing", () => {
    const result = planObjective({ goal: "Set up my new business with a website and email" });
    expect(result).toEqual({ ok: false, reason: "missing_inputs", missing: [{ field: "businessName", question: "What is the business called?" }] });
  });

  it("refuses goals it has no vetted plan for rather than improvising", () => {
    expect(planObjective({ goal: "Book me a flight to Paris" }).ok).toBe(false);
  });

  it("only accepts syntactically valid domains", () => {
    expect(normalizeDomain("https://Example.COM/path")).toBe("example.com");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("evil.com/../x")).toBe("evil.com");
    expect(normalizeDomain("a..b.com")).toBeNull();
  });

  it("every planned step's tool is allowed for its role, and QA depends on everything", () => {
    const plan = businessSetupPlan({ businessName: "X Co", domains: ["xco.com"], description: null });
    for (const step of plan.steps) expect(roleAllowsTool(step.role, step.toolKey), `${step.role} -> ${step.toolKey}`).toBe(true);
    const qa = plan.steps.find((s) => s.key === "qa")!;
    expect(qa.dependsOn).toHaveLength(plan.steps.length - 1);
    expect(WORKFORCE_ROLES).toHaveLength(8);
  });

  it("rejects cyclic plans", () => {
    const plan = businessSetupPlan({ businessName: "X", domains: ["x.com"], description: null });
    plan.steps[0].dependsOn = ["qa"];
    expect(() => assertValidPlan(plan)).toThrow(/cycle/);
  });
});
