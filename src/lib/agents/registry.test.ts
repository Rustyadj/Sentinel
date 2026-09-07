import { describe, expect, it } from "vitest";
import { getVpsAgent } from "./registry";
import { COMPATIBILITY_RUNTIMES } from "./runtime/config";

const WORKER_IDS = ["hermes-lisa", "hermes-nathan2", "claude-code", "codex"] as const;

describe("legacy agent registry compatibility", () => {
  it.each(WORKER_IDS)("keeps %s aligned with its dispatch runtime", (agentId) => {
    const agent = getVpsAgent(agentId);
    const runtime = COMPATIBILITY_RUNTIMES.find((candidate) => candidate.agentId === agentId);

    expect(agent).toBeDefined();
    expect(runtime).toBeDefined();
    expect(agent?.kind).toBe(runtime?.kind);

    if (runtime?.transport === "process") {
      expect(runtime.executable).toEqual(expect.any(String));
      expect(agent?.endpoint).toBe("");
    } else {
      expect(agent?.endpoint).toBe(runtime?.endpoint);
      expect(agent?.containerName).toBe(runtime?.containerName);
      expect(agent?.configPath).toBe(runtime?.configPath);
      expect(agent?.logPath).toBe(runtime?.logSource?.ref);
      expect(agent?.model).toBe(runtime?.model);
      expect(agent?.legacyPath).toBe(runtime?.nativeUiUrl ?? null);
    }
  });

  it("uses Nathan2's verified runtime port in both registry fields", () => {
    const nathan = getVpsAgent("hermes-nathan2");
    expect(nathan?.endpoint).toBe("http://127.0.0.1:4864");
    expect(nathan?.dashboardPort).toBe(4864);
  });
});
