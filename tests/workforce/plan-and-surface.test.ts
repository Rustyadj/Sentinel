import { describe, expect, it } from "vitest";
import { summarizeRecordedSteps } from "@/lib/workforce/analytics";
import { marketingPlan, workforcePlanSchema } from "@/lib/workforce/plan";
import { objectiveActionKey, surfaceSchema } from "@/lib/workforce/surface";

describe("workforce drafts", () => {
  it("describes five distinct Titan ICF marketing specialties and weekly reporting", () => {
    const plan = workforcePlanSchema.parse(marketingPlan("Titan ICF"));
    expect(plan.department.description).toContain("Titan ICF");
    expect(plan.specialists.map(({ key }) => key)).toEqual(["leads", "seo", "content", "competition", "reporting"]);
    expect(plan.specialists.find(({ key }) => key === "reporting")?.objectives[0]).toMatchObject({ cadence: "weekly" });
    expect(plan.specialists.filter(({ reportsTo }) => reportsTo === "reporting")).toHaveLength(4);
  });

  it("rejects duplicates, unknown reporting managers, cycles, and authority fields", () => {
    const plan = marketingPlan("Titan ICF");
    for (const update of [
      { key: "seo" }, { reportsTo: "outside" }, { reportsTo: "leads" }, { authority: "all" },
    ]) {
      const draft = { ...plan, specialists: plan.specialists.map((specialist, i) => i === 0 ? { ...specialist, ...update } : specialist) };
      expect(workforcePlanSchema.safeParse(draft).success).toBe(false);
    }
    plan.specialists[4].reportsTo = "leads";
    expect(workforcePlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe("declarative workforce surfaces", () => {
  it("accepts typed, scoped action references and rejects executable properties", () => {
    const action = { type: "action", id: "retry", label: "Retry", action: "retry_step", objectiveId: "objective_a", stepKey: "deliverable.verify" } as const;
    expect(surfaceSchema.safeParse({ version: 1, title: "Status", components: [action] }).success).toBe(true);
    expect(surfaceSchema.safeParse({ version: 1, title: "Status", components: [{ ...action, href: "javascript:alert(1)" }] }).success).toBe(false);
    expect(surfaceSchema.safeParse({ version: 1, title: "Status", components: [action, action] }).success).toBe(false);
    expect(surfaceSchema.safeParse({ version: 1, title: "Status", components: [{ ...action, stepKey: undefined }] }).success).toBe(false);
    expect(objectiveActionKey(action)).not.toEqual(objectiveActionKey({ ...action, objectiveId: "objective_b" }));
  });
});

describe("recorded objective metrics", () => {
  it("keeps estimates separate from recorded charges and excludes unsettled steps from success rate", () => {
    const sample = { status: "completed", attempts: 2, actualCostCents: 8, estimatedCostCents: 12, startedAt: new Date(1000), completedAt: new Date(5000) };
    expect(summarizeRecordedSteps([
      sample, { ...sample, status: "failed" }, { ...sample, status: "waiting_approval", actualCostCents: 0 },
    ])).toEqual({
      completed: 1, failed: 1, completedAfterRetry: 1, recordedCostCents: 16,
      estimatedCostCents: 36, averageDurationMs: 4000, successRate: 0.5,
    });
    expect(summarizeRecordedSteps([])).toMatchObject({ averageDurationMs: null, successRate: null });
  });
});
