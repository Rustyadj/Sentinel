import { describe, expect, it } from "vitest";
import { ALLOWED_AGENT_IDS, getAllVpsAgents, getVpsAgent } from "@/lib/agents/registry";
import { COMPATIBILITY_RUNTIMES } from "@/lib/agents/runtime/config";
import { getRuntimeView, listRuntimeViews } from "@/lib/agents/runtime/service";

describe("retired active agents", () => {
  it("excludes OpenClaw and Gemini from the VPS registry", () => {
    expect(getAllVpsAgents().map((agent) => agent.id)).not.toEqual(expect.arrayContaining(["openclaw", "gemini"]));
    expect(getVpsAgent("openclaw")).toBeUndefined();
    expect(getVpsAgent("gemini")).toBeUndefined();
    expect(ALLOWED_AGENT_IDS.has("openclaw")).toBe(false);
    expect(ALLOWED_AGENT_IDS.has("gemini")).toBe(false);
  });

  it("excludes retired compatibility and persisted runtime lookups", async () => {
    expect(COMPATIBILITY_RUNTIMES.some((runtime) => runtime.agentId === "openclaw")).toBe(true);
    expect(COMPATIBILITY_RUNTIMES.some((runtime) => runtime.agentId === "gemini")).toBe(true);
    expect((await listRuntimeViews()).map((runtime) => runtime.agentId)).not.toEqual(expect.arrayContaining(["openclaw", "gemini"]));
    await expect(getRuntimeView("openclaw")).resolves.toBeNull();
    await expect(getRuntimeView("runtime-openclaw")).resolves.toBeNull();
    await expect(getRuntimeView("gemini")).resolves.toBeNull();
    await expect(getRuntimeView("runtime-gemini")).resolves.toBeNull();
  });
});
