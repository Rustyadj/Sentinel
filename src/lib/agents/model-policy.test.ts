import { afterEach, describe, expect, it } from "vitest";
import {
  ModelUnavailableError,
  isManagedWorkerKind,
  looksLikeModelUnavailable,
  resolveWorkerModel,
} from "./model-policy";

const ENV_KEYS = [
  "SENTINEL_CLAUDE_DEFAULT_MODEL", "SENTINEL_CLAUDE_DEFAULT_EFFORT",
  "SENTINEL_CODEX_DEFAULT_MODEL", "SENTINEL_CODEX_DEFAULT_EFFORT",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("resolveWorkerModel", () => {
  it("returns Sentinel's built-in defaults with no env overrides set", () => {
    expect(resolveWorkerModel("claude-code")).toMatchObject({ displayName: "claude-opus-5", runtimeModelId: "claude-opus-5", effort: "low" });
    expect(resolveWorkerModel("codex")).toMatchObject({ displayName: "gpt-6-astra", runtimeModelId: "gpt-6-astra", effort: "low" });
  });

  it("lets an env override win for the runtime model id and effort, but never the display name", () => {
    process.env.SENTINEL_CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-6";
    process.env.SENTINEL_CLAUDE_DEFAULT_EFFORT = "medium";
    const resolved = resolveWorkerModel("claude-code");
    expect(resolved.runtimeModelId).toBe("claude-sonnet-4-6");
    expect(resolved.effort).toBe("medium");
    expect(resolved.displayName).toBe("claude-sonnet-4-6");
  });

  it("overrides codex independently of claude-code", () => {
    process.env.SENTINEL_CODEX_DEFAULT_MODEL = "gpt-5-codex";
    process.env.SENTINEL_CODEX_DEFAULT_EFFORT = "low";
    expect(resolveWorkerModel("codex")).toMatchObject({ displayName: "gpt-5-codex", runtimeModelId: "gpt-5-codex", effort: "low" });
    // Unaffected
    expect(resolveWorkerModel("claude-code").runtimeModelId).toBe("claude-opus-5");
  });

  it("falls back to the built-in effort for an invalid override value rather than accepting anything", () => {
    process.env.SENTINEL_CLAUDE_DEFAULT_EFFORT = "maximum-overdrive";
    expect(() => resolveWorkerModel("claude-code")).toThrow("INVALID_EFFORT");
  });
});

describe("isManagedWorkerKind", () => {
  it("accepts only claude-code and codex", () => {
    expect(isManagedWorkerKind("claude-code")).toBe(true);
    expect(isManagedWorkerKind("codex")).toBe(true);
    expect(isManagedWorkerKind("hermes")).toBe(false);
    expect(isManagedWorkerKind("openclaw")).toBe(false);
  });
});

describe("looksLikeModelUnavailable", () => {
  it("recognizes common model-rejection phrasing", () => {
    expect(looksLikeModelUnavailable("Error: model 'claude-opus-5' not found")).toBe(true);
    expect(looksLikeModelUnavailable("model not supported by this account")).toBe(true);
    expect(looksLikeModelUnavailable("unknown model: gpt-6-astra")).toBe(true);
  });

  it("does not flag an ordinary failure that happens to mention neither pattern", () => {
    expect(looksLikeModelUnavailable("Error: permission denied writing to /repo/file.ts")).toBe(false);
    expect(looksLikeModelUnavailable("network timeout after 30s")).toBe(false);
  });
});

describe("ModelUnavailableError", () => {
  it("carries the requested model/effort/runtime and a message naming MODEL_UNAVAILABLE", () => {
    const error = new ModelUnavailableError("codex", "gpt-6-astra", "high", "model not found");
    expect(error.kind).toBe("codex");
    expect(error.requestedModel).toBe("gpt-6-astra");
    expect(error.requestedEffort).toBe("high");
    expect(error.message).toContain("MODEL_UNAVAILABLE");
    expect(error.message).toContain("gpt-6-astra");
    // Never fabricates an "available models" list — see the class doc comment.
    expect(error.message.toLowerCase()).not.toContain("available models");
  });
});
