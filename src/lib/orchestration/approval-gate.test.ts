import { describe, expect, it } from "vitest";
import { assessRisk, requiresApproval } from "./approval-gate";

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

describe("requiresApproval", () => {
  it("only gates medium and high risk", () => {
    expect(requiresApproval("low")).toBe(false);
    expect(requiresApproval("medium")).toBe(true);
    expect(requiresApproval("high")).toBe(true);
  });
});
