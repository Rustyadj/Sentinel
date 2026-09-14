import { describe, expect, it } from "vitest";
import { compatibilityRuntime, COMPATIBILITY_RUNTIMES } from "./config";

describe("runtime execution verification", () => {
  it("keeps Nathan2 registered but explicitly unverified independent of reachability", () => {
    const nathan2 = compatibilityRuntime("hermes-nathan2");
    expect(nathan2).toMatchObject({ enabled: true, executionVerified: false, endpoint: "http://127.0.0.1:4864" });
  });
  it("uses the verified Lisa and OpenClaw defaults consistently", () => {
    expect(compatibilityRuntime("hermes-lisa")?.endpoint).toBe("http://127.0.0.1:4862");
    expect(compatibilityRuntime("openclaw")?.endpoint).toBe("http://127.0.0.1:18789/readyz");
  });

  it("marks every audited runtime verified so dispatch has real candidates", () => {
    for (const id of ["hermes-lisa", "openclaw", "claude-code", "codex", "gemini"]) {
      expect(compatibilityRuntime(id)?.executionVerified, id).toBe(true);
    }
  });

  it("leaves Nathan2 as the only registered but non-dispatchable runtime", () => {
    const unverified = COMPATIBILITY_RUNTIMES.filter((runtime) => !runtime.executionVerified).map((runtime) => runtime.agentId);
    expect(unverified).toEqual(["hermes-nathan2"]);
  });
});
