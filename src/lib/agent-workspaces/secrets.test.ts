import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSecrets, resolveSecrets } from "./secrets";
afterEach(() => vi.unstubAllEnvs());
describe("agent-scoped Git credentials", () => {
  it("keeps coding-agent credentials independent from each other and the legacy token", () => {
    vi.stubEnv("SENTINEL_WORKSPACE_GIT_TOKEN", "legacy-token");
    vi.stubEnv("SENTINEL_CLAUDE_CODE_GIT_TOKEN", "claude-token");
    vi.stubEnv("SENTINEL_CODEX_GIT_TOKEN", "codex-token");
    expect(resolveSecrets("git", "claude-code").SENTINEL_GIT_TOKEN).toBe("claude-token");
    expect(resolveSecrets("git", "codex").SENTINEL_GIT_TOKEN).toBe("codex-token");
    expect(resolveSecrets("git", "hermes-lisa").SENTINEL_GIT_TOKEN).toBe("legacy-token");
    expect(resolveSecrets("git", "hermes-nathan2").SENTINEL_GIT_TOKEN).toBe("legacy-token");
  });
  it("fails closed when a coding computer has no own Git key", () => {
    vi.stubEnv("SENTINEL_WORKSPACE_GIT_TOKEN", "legacy-token");
    vi.stubEnv("SENTINEL_CLAUDE_CODE_GIT_TOKEN", "peer-token");
    vi.stubEnv("SENTINEL_CODEX_GIT_TOKEN", "");
    expect(resolveSecrets("git", "codex")).toEqual({});
    expect(() => requireSecrets("git", "codex")).toThrow(/scoped Git token/);
  });
});
