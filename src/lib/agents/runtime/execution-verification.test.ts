import { describe, expect, it } from "vitest";
import { compatibilityRuntime, COMPATIBILITY_RUNTIMES } from "./config";

describe("runtime execution verification", () => {
  it("declares Nathan2 verified on its audited endpoint", () => {
    const nathan2 = compatibilityRuntime("hermes-nathan2");
    expect(nathan2).toMatchObject({ enabled: true, executionVerified: true, endpoint: "http://127.0.0.1:4864" });
  });

  it("uses the verified Lisa default consistently", () => {
    expect(compatibilityRuntime("hermes-lisa")?.endpoint).toBe("http://127.0.0.1:4862");
  });

  it("no longer offers the retired runtimes as dispatch candidates", () => {
    // OpenClaw was removed from the runtime surface (20260914120000 /
    // 20260920140000 and the commits that retired its wiring). This test still
    // asserted its endpoint and its verified flag afterwards, so the suite was
    // red on main. Asserting the retirement instead keeps the check honest and
    // catches an accidental reintroduction.
    expect(compatibilityRuntime("openclaw")).toBeUndefined();
  });

  it("marks every audited runtime verified so dispatch has real candidates", () => {
    for (const id of ["hermes-lisa", "hermes-nathan2", "claude-code", "codex", "gemini"]) {
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
