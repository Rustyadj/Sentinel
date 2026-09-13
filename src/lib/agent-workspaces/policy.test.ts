import { describe, expect, it } from "vitest";
import { WorkspaceError, translateRuntimeFailure } from "./errors";
import {
  assertClientAllowed, assertCommandShape, assertDelegationAllowed,
  DEFAULT_POLICY, parseLimits, parsePolicy, resolveWorkspacePath,
} from "./policy";

describe("workspace path containment", () => {
  it("resolves relative paths inside the workspace home", () => {
    expect(resolveWorkspacePath("/workspace", "repos/app")).toBe("/workspace/repos/app");
    expect(resolveWorkspacePath("/workspace", "/repos/app")).toBe("/workspace/repos/app");
    expect(resolveWorkspacePath("/workspace", undefined)).toBe("/workspace");
  });

  it("accepts a path it previously returned without re-prefixing the home", () => {
    expect(resolveWorkspacePath("/workspace", "/workspace")).toBe("/workspace");
    expect(resolveWorkspacePath("/workspace", "/workspace/repos/app")).toBe("/workspace/repos/app");
    // A sibling directory that merely shares the prefix is still relative.
    expect(resolveWorkspacePath("/workspace", "/workspace-other/x")).toBe("/workspace/workspace-other/x");
  });

  it("rejects traversal out of the workspace", () => {
    for (const attempt of ["../etc/passwd", "repos/../../etc", "/../root", "repos/../../../"]) {
      expect(() => resolveWorkspacePath("/workspace", attempt)).toThrow(WorkspaceError);
    }
  });

  it("rejects control characters", () => {
    expect(() => resolveWorkspacePath("/workspace", "repos\nrm -rf")).toThrow(/invalid characters/);
  });
});

describe("resource policy parsing", () => {
  it("falls back to defaults and clamps out-of-range values", () => {
    const limits = parseLimits({ cpus: 9999, memoryMb: 1, commandTimeoutMs: 10 });
    expect(limits.cpus).toBe(16);
    expect(limits.memoryMb).toBe(256);
    expect(limits.commandTimeoutMs).toBe(1000);
    expect(limits.network).toBe("bridge");
  });

  it("defaults cross-client delegation to explicit-only", () => {
    expect(parsePolicy({}).crossAgentDelegation).toBe("explicit-only");
    expect(parsePolicy({ crossAgentDelegation: "nonsense" }).crossAgentDelegation).toBe("explicit-only");
    expect(parsePolicy({ crossAgentDelegation: "denied" }).crossAgentDelegation).toBe("denied");
  });
});

describe("cross-client delegation policy", () => {
  it("blocks Claude Code from delegating to Codex without operator authorization", () => {
    expect(() => assertDelegationAllowed({
      policy: DEFAULT_POLICY,
      fromClient: "claude-code",
      toClient: "codex",
    })).toThrow(/without explicit operator authorization/);
  });

  it("blocks Codex from delegating to Claude Code without operator authorization", () => {
    expect(() => assertDelegationAllowed({
      policy: DEFAULT_POLICY,
      fromClient: "codex",
      toClient: "claude-code",
      explicitAuthorization: null,
    })).toThrow(WorkspaceError);
  });

  it("rejects an authorization with no operator or no reason", () => {
    expect(() => assertDelegationAllowed({
      policy: DEFAULT_POLICY,
      fromClient: "codex",
      toClient: "claude-code",
      explicitAuthorization: { authorizedByUserId: "", reason: "split this task" },
    })).toThrow(WorkspaceError);
    expect(() => assertDelegationAllowed({
      policy: DEFAULT_POLICY,
      fromClient: "codex",
      toClient: "claude-code",
      explicitAuthorization: { authorizedByUserId: "user_1", reason: "   " },
    })).toThrow(WorkspaceError);
  });

  it("allows a handoff the operator explicitly authorized", () => {
    expect(() => assertDelegationAllowed({
      policy: DEFAULT_POLICY,
      fromClient: "claude-code",
      toClient: "codex",
      explicitAuthorization: { authorizedByUserId: "user_1", reason: "operator asked to split this task" },
    })).not.toThrow();
  });

  it("never blocks a client from continuing its own work", () => {
    expect(() => assertDelegationAllowed({
      policy: { ...DEFAULT_POLICY, crossAgentDelegation: "denied" },
      fromClient: "claude-code",
      toClient: "claude-code",
    })).not.toThrow();
  });

  it("honours a workspace that disables delegation entirely", () => {
    expect(() => assertDelegationAllowed({
      policy: { ...DEFAULT_POLICY, crossAgentDelegation: "denied" },
      fromClient: "claude-code",
      toClient: "codex",
      explicitAuthorization: { authorizedByUserId: "user_1", reason: "split it" },
    })).toThrow(/disabled for this workspace/);
  });
});

describe("client allowlist and command shape", () => {
  it("rejects a runtime client the workspace does not permit", () => {
    const policy = { ...DEFAULT_POLICY, allowedRuntimeClients: ["hermes" as const] };
    expect(() => assertClientAllowed(policy, "codex")).toThrow(/not permitted/);
    expect(() => assertClientAllowed(policy, "hermes")).not.toThrow();
  });

  it("rejects empty and null-byte commands", () => {
    expect(() => assertCommandShape("   ")).toThrow(WorkspaceError);
    expect(() => assertCommandShape("ls\0")).toThrow(WorkspaceError);
    expect(() => assertCommandShape("ls -la")).not.toThrow();
  });
});

describe("runtime failure translation", () => {
  it("maps backend noise onto stable codes and keeps raw text as admin detail", () => {
    const missing = translateRuntimeFailure("Error: No such container: sentinel-ws-abc");
    expect(missing.code).toBe("runtime_not_found");
    expect(missing.message).not.toContain("sentinel-ws-abc");
    expect(missing.detail).toContain("sentinel-ws-abc");

    expect(translateRuntimeFailure("write /data: no space left on device").code).toBe("disk_full");
    expect(translateRuntimeFailure("Cannot connect to the Docker daemon").code).toBe("runtime_unavailable");
    expect(translateRuntimeFailure("something unexpected").code).toBe("runtime_unavailable");
  });
});
