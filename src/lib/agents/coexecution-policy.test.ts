import { describe, expect, it } from "vitest";
import { assertConcurrentDispatchAllowed } from "./coexecution-policy";

describe("coexecution policy", () => {
  it("blocks concurrent Claude Code and Codex dispatch by default", () => {
    expect(() => assertConcurrentDispatchAllowed(["claude-code", "codex"])).toThrow(/cannot be concurrently dispatched/);
  });
  it("allows an explicit user override", () => {
    expect(() => assertConcurrentDispatchAllowed(["claude-code", "codex"], true)).not.toThrow();
  });
});
