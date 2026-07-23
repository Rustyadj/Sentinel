import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
import { scanSkillCandidate } from "@/lib/adaptive-memory/skill-refinery";
import { authorizeTrust, requiredTrustLevel } from "@/lib/adaptive-memory/trust";
import { MCP_TOOLS } from "@/lib/mcp/catalog";
describe("skill refinery and trust ladder", () => {
  it("rejects a single-run skill", () => expect(scanSkillCandidate({ description: "Safe", purpose: "Test", steps: [], toolPermissions: [], sourceRunIds: ["r1"], rollbackSteps: [] }).map((item) => item.code)).toContain("insufficient_independent_runs"));
  it("requires rollback for write-capable skills", () => expect(scanSkillCandidate({ description: "Safe", purpose: "Test", steps: [], toolPermissions: ["update_task"], sourceRunIds: ["r1", "r2"], rollbackSteps: [] }).map((item) => item.code)).toContain("write_tool_without_rollback"));
  it("always gates level four with human approval", () => {
    expect(requiredTrustLevel("deploy_production", true)).toBe(4);
    expect(authorizeTrust({ configuredLevel: 4, operation: "deploy_production", mutates: true }).allowed).toBe(false);
  });
  it("does not publish unrestricted infrastructure tools", () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).not.toContain("execute_shell");
    expect(MCP_TOOLS.map((tool) => tool.name)).not.toContain("run_sql");
    expect(MCP_TOOLS.map((tool) => tool.name)).not.toContain("deploy_production");
  });
});
