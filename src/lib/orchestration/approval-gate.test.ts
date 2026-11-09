import { describe, expect, it } from "vitest";
import { classifyTaskAction, displayRiskFloor, escalateRisk, requiresHumanApproval } from "./action-policy";
import { assessRisk } from "./approval-gate";

describe("assessRisk", () => {
  it("flags destructive operations as high risk", () => {
    expect(assessRisk("run prisma migrate deploy against the tenant db")).toBe("high");
    expect(assessRisk("DROP TABLE users;")).toBe("high");
    expect(assessRisk("rm -rf ./dist")).toBe("high");
    expect(assessRisk("force-push over main")).toBe("high");
    expect(assessRisk("apply this straight to production")).toBe("high");
  });

  it("flags sensitive-but-not-destructive operations as medium risk", () => {
    expect(assessRisk("rotate the auth config secret")).toBe("medium");
    expect(assessRisk("deploy the staging build")).toBe("medium");
  });

  it("treats ordinary requests as low risk", () => {
    expect(assessRisk("add a unit test for the task router")).toBe("low");
  });
});

describe("assessRisk as an escalator only", () => {
  it("never lowers a capability-derived requirement: a keyword-free coding task is still gated", () => {
    const cls = classifyTaskAction({ capabilities: ["backend"], fileScope: [] }, { kind: "claude-code" });
    expect(assessRisk("Tidy config")).toBe("low");
    expect(requiresHumanApproval(cls)).toBe(true);
    expect(escalateRisk(displayRiskFloor(cls), assessRisk("Tidy config"))).toBe("medium");
  });

  it("raises the displayed label above the class floor when keywords warrant it", () => {
    expect(escalateRisk(displayRiskFloor("read"), assessRisk("apply this straight to production"))).toBe("high");
    expect(escalateRisk(displayRiskFloor("deploy"), assessRisk("add a unit test"))).toBe("high");
  });
});
