import { describe, expect, it } from "vitest";
import { compatibilityRuntime, COMPATIBILITY_RUNTIMES } from "./config";

describe("runtime execution verification", () => {
  it("declares Nathan2 verified on its audited endpoint", () => {
    const nathan2 = compatibilityRuntime("hermes-nathan2");
    expect(nathan2).toMatchObject({ enabled: true, executionVerified: true, endpoint: "http://127.0.0.1:4864" });
  });

  it("uses the verified Lisa and OpenClaw defaults consistently", () => {
    expect(compatibilityRuntime("hermes-lisa")?.endpoint).toBe("http://127.0.0.1:4862");
    expect(compatibilityRuntime("openclaw")?.endpoint).toBe("http://127.0.0.1:18789/readyz");
  });

  it("marks every audited runtime verified so dispatch has real candidates", () => {
    for (const id of ["hermes-lisa", "hermes-nathan2", "openclaw", "claude-code", "codex", "gemini"]) {
      expect(compatibilityRuntime(id)?.executionVerified, id).toBe(true);
    }
  });

  it("states verification explicitly for every runtime rather than inferring it", () => {
    // The invariant that outlives any individual agent's status: verification is
    // a declared boolean on each runtime, never derived from reachability. A new
    // runtime added without an explicit decision fails here.
    for (const runtime of COMPATIBILITY_RUNTIMES) {
      expect(typeof runtime.executionVerified, runtime.agentId).toBe("boolean");
    }
  });
});
