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
    expect(resolveWorkerModel("claude-code")).toEqual({ displayName: "Claude Sonnet 5", runtimeModelId: "claude-sonnet-5", effort: "high" });
    expect(resolveWorkerModel("codex")).toEqual({ displayName: "GPT-5.6 Sol", runtimeModelId: "gpt-5.6-sol", effort: "high" });
  });

  it("lets an env override win for the runtime model id and effort, but never the display name", () => {
    process.env.SENTINEL_CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-6";
    process.env.SENTINEL_CLAUDE_DEFAULT_EFFORT = "medium";
    const resolved = resolveWorkerModel("claude-code");
    expect(resolved.runtimeModelId).toBe("claude-sonnet-4-6");
    expect(resolved.effort).toBe("medium");
    expect(resolved.displayName).toBe("Claude Sonnet 5");
  });

  it("overrides codex independently of claude-code", () => {
    process.env.SENTINEL_CODEX_DEFAULT_MODEL = "gpt-5-codex";
    process.env.SENTINEL_CODEX_DEFAULT_EFFORT = "low";
    expect(resolveWorkerModel("codex")).toEqual({ displayName: "GPT-5.6 Sol", runtimeModelId: "gpt-5-codex", effort: "low" });
    // Unaffected
    expect(resolveWorkerModel("claude-code").runtimeModelId).toBe("claude-sonnet-5");
  });

  it("falls back to the built-in effort for an invalid override value rather than accepting anything", () => {
    process.env.SENTINEL_CLAUDE_DEFAULT_EFFORT = "maximum-overdrive";
    expect(resolveWorkerModel("claude-code").effort).toBe("high");
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
    expect(looksLikeModelUnavailable("Error: model 'claude-sonnet-5' not found")).toBe(true);
    expect(looksLikeModelUnavailable("model not supported by this account")).toBe(true);
    expect(looksLikeModelUnavailable("unknown model: gpt-5.6-sol")).toBe(true);
  });

  it("does not flag an ordinary failure that happens to mention neither pattern", () => {
    expect(looksLikeModelUnavailable("Error: permission denied writing to /repo/file.ts")).toBe(false);
    expect(looksLikeModelUnavailable("network timeout after 30s")).toBe(false);
  });
});

describe("ModelUnavailableError", () => {
  it("carries the requested model/effort/runtime and a message naming MODEL_UNAVAILABLE", () => {
    const error = new ModelUnavailableError("codex", "gpt-5.6-sol", "high", "model not found");
    expect(error.kind).toBe("codex");
    expect(error.requestedModel).toBe("gpt-5.6-sol");
    expect(error.requestedEffort).toBe("high");
    expect(error.message).toContain("MODEL_UNAVAILABLE");
    expect(error.message).toContain("gpt-5.6-sol");
    // Never fabricates an "available models" list — see the class doc comment.
    expect(error.message.toLowerCase()).not.toContain("available models");
  });
});
