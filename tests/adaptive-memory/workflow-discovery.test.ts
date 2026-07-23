import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
import { workflowSignature } from "@/lib/adaptive-memory/workflow-discovery";
describe("workflow discovery", () => {
  it("generalizes variable numeric fields", () => {
    expect(workflowSignature(["crm.search", "report.create"], ["lead 123", "week 42"]))
      .toBe(workflowSignature(["crm.search", "report.create"], ["lead 999", "week 43"]));
  });
  it("keeps different tool sequences separate", () => expect(workflowSignature(["crm.search"], ["lead 1"])).not.toBe(workflowSignature(["crm.delete"], ["lead 1"])));
});
