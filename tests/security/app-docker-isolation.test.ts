import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceError } from "@/lib/agent-workspaces/errors";
import { DockerWorkspaceProvider, containerNameFor, volumeNameFor } from "@/lib/agent-workspaces/providers/docker";
import { getRuntimeProvider, resetRuntimeProvidersForTests } from "@/lib/agent-workspaces/providers";
import { RemoteWorkspaceProvider, resetRunnerClientForTests } from "@/lib/agent-workspaces/runner/client";
import { validateProviderCall } from "@/lib/agent-workspaces/runner/guard";
import { RUNNER_SIGNATURE_HEADER } from "@/lib/agent-workspaces/runner/protocol";
import { getContainerLogs } from "@/lib/agents/processControl";

// The internet-facing app holds no Docker socket (docs/SECURITY_REMEDIATION.md C1).
// In production every Docker operation must go through the workspace runner, and a
// missing runner must be an error — never a quiet fallback to a local socket.

const SECRET = "r".repeat(40);
const WS = "cmwsiso123";
const IMAGE = "sentinel/agent-workspace:base";

function reset() {
  resetRuntimeProvidersForTests();
  resetRunnerClientForTests();
}

beforeEach(() => {
  reset();
  vi.stubEnv("WORKSPACE_RUNNER_URL", "");
  vi.stubEnv("WORKSPACE_RUNNER_SECRET", SECRET);
  vi.stubEnv("AGENT_WORKSPACE_IMAGE", "");
  vi.stubEnv("AGENT_WORKSPACE_ALLOWED_IMAGES", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  reset();
});

describe("workspace provider registry", () => {
  it("throws in production when no runner is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getRuntimeProvider("docker")).toThrowError(WorkspaceError);
    expect(() => getRuntimeProvider("docker")).toThrowError(/WORKSPACE_RUNNER_URL/);
  });

  it("returns the remote provider in production when the runner is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSPACE_RUNNER_URL", "http://workspace-runner:8790");
    const provider = getRuntimeProvider("docker");
    expect(provider).toBeInstanceOf(RemoteWorkspaceProvider);
    expect(provider).not.toBeInstanceOf(DockerWorkspaceProvider);
  });

  it("keeps the local provider for development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getRuntimeProvider("docker")).toBeInstanceOf(DockerWorkspaceProvider);
  });
});

describe("agent container logs", () => {
  it("are read through the runner with a signed request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSPACE_RUNNER_URL", "http://workspace-runner:8790");
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ stdout: "one\ntwo", stderr: "" }));
    vi.stubGlobal("fetch", fetcher);

    await expect(getContainerLogs("hermes-lisa", 9_999)).resolves.toEqual({ stdout: "one\ntwo", stderr: "" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://workspace-runner:8790/v1/containers/logs");
    expect(JSON.parse(String(init.body))).toEqual({ name: "hermes-lisa", tail: 500 });
    expect((init.headers as Record<string, string>)[RUNNER_SIGNATURE_HEADER]).toBeTruthy();
  });

  it("fail closed in production without a runner", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(getContainerLogs("hermes-lisa", 10)).rejects.toThrowError(WorkspaceError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("runner guard at the Docker boundary", () => {
  const spec = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: WS, agentId: "lisa", image: IMAGE, homePath: "/workspace",
    limits: { cpus: 2, memoryMb: 4096, diskGb: 20, pidsLimit: 512, commandTimeoutMs: 120_000, idleTimeoutMs: 3_600_000, network: "bridge" },
    ...overrides,
  });
  const rejects = (fn: () => unknown) => expect(fn).toThrowError(WorkspaceError);

  it("rejects --privileged in every field that reaches docker argv", () => {
    rejects(() => validateProviderCall("createWorkspace", [spec({ image: "--privileged" })]));
    rejects(() => validateProviderCall("createWorkspace", [spec({ workspaceId: "--privileged=true" })]));
    // An id may start with "-", but it only ever reaches argv behind a fixed prefix.
    expect(containerNameFor("--privileged")).toBe("sentinel-ws---privileged");
    expect(volumeNameFor("--privileged")).toBe("sentinel-ws-data---privileged");
    // Flags smuggled as extra properties never reach the provider.
    const [sanitized] = validateProviderCall("createWorkspace", [spec({ privileged: true, capAdd: ["SYS_ADMIN"], securityOpt: ["seccomp=unconfined"] })]) as [Record<string, unknown>];
    expect(Object.keys(sanitized).sort()).toEqual(["agentId", "homePath", "image", "limits", "workspaceId"]);
  });

  it("rejects host bind mounts", () => {
    for (const volumeName of ["/", "/var/run/docker.sock", "/etc:/host-etc", "/root/.claude", "sentinel-os_postgres_data"]) {
      rejects(() => validateProviderCall("startWorkspace", [spec({ volumeName })]));
      rejects(() => validateProviderCall("createSnapshot", [WS, volumeName, "snap1"]));
    }
    rejects(() => validateProviderCall("createWorkspace", [spec({ homePath: "/workspace:/var/run/docker.sock" })]));
    rejects(() => validateProviderCall("createWorkspace", [spec({ homePath: "/var/run/docker.sock,/x" })]));
    expect(validateProviderCall("startWorkspace", [spec({ volumeName: volumeNameFor(WS) })])).toHaveLength(1);
  });

  it("rejects images that are not on the allowlist", () => {
    for (const image of ["docker:dind", "alpine:latest", "sentinel/agent-workspace:base@sha256:x", `${IMAGE} --privileged`]) {
      rejects(() => validateProviderCall("createWorkspace", [spec({ image })]));
    }
    expect(validateProviderCall("createWorkspace", [spec()])).toHaveLength(1);
  });
});
