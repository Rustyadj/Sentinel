import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceError } from "@/lib/agent-workspaces/errors";
import { volumeNameFor } from "@/lib/agent-workspaces/providers/docker";
import { RemoteContainers, RemoteWorkspaceProvider, RunnerClient } from "@/lib/agent-workspaces/runner/client";
import { projectInspect } from "@/lib/agent-workspaces/runner/containers";
import { validateProviderCall } from "@/lib/agent-workspaces/runner/guard";
import {
  PROVIDER_METHODS, RUNNER_SIGNATURE_HEADER, RUNNER_TIMESTAMP_HEADER, signRunnerRequest, verifyRunnerRequest,
} from "@/lib/agent-workspaces/runner/protocol";
import { createRunnerHandler } from "@/lib/agent-workspaces/runner/server";
import type { WorkspaceRuntimeProvider } from "@/lib/agent-workspaces/types";

const SECRET = "s".repeat(40);
const WS = "cmwsabc123";
const IMAGE = "sentinel/agent-workspace:base";
const spec = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WS, agentId: "lisa", image: IMAGE, homePath: "/workspace",
  limits: { cpus: 2, memoryMb: 4096, diskGb: 20, pidsLimit: 512, commandTimeoutMs: 120_000, idleTimeoutMs: 3_600_000, network: "bridge" },
  ...overrides,
});
const rejects = (fn: () => unknown) => expect(fn).toThrowError(WorkspaceError);

const env = { ...process.env };
beforeEach(() => { delete process.env.AGENT_WORKSPACE_IMAGE; delete process.env.AGENT_WORKSPACE_ALLOWED_IMAGES; });
afterEach(() => { process.env = { ...env }; });

describe("runner guard", () => {
  it("covers every provider method", () => {
    // A method missing from the switch would return undefined instead of args or a rejection.
    for (const method of PROVIDER_METHODS) {
      try {
        expect(Array.isArray(validateProviderCall(method, [])), method).toBe(true);
      } catch (error) {
        expect(error, method).toBeInstanceOf(WorkspaceError);
      }
    }
  });

  it("refuses volume names that do not belong to the workspace", () => {
    const volumeName = volumeNameFor(WS);
    expect(validateProviderCall("startWorkspace", [spec({ volumeName })])).toHaveLength(1);
    for (const bad of ["/", "/etc", "postgres_data", volumeNameFor("other")]) {
      rejects(() => validateProviderCall("startWorkspace", [spec({ volumeName: bad })]));
      rejects(() => validateProviderCall("createSnapshot", [WS, bad, "snap1"]));
      rejects(() => validateProviderCall("restoreSnapshot", [WS, bad, `${WS}__snap1.tar.gz`]));
    }
  });

  it("only destroys workspace data volumes", () => {
    expect(validateProviderCall("destroyWorkspaceData", [volumeNameFor(WS)])).toEqual([volumeNameFor(WS)]);
    for (const bad of ["sentinel-os_postgres_data", "redis_data", "sentinel-ws-data-../x", "/"]) {
      rejects(() => validateProviderCall("destroyWorkspaceData", [bad]));
    }
  });

  it("restricts identifiers interpolated into the snapshot helper's shell script", () => {
    for (const bad of ['a"; rm -rf /snapshots; "', "a b", "../x", "", "x".repeat(65)]) {
      rejects(() => validateProviderCall("createSnapshot", [bad, volumeNameFor(WS), "snap1"]));
      rejects(() => validateProviderCall("createSnapshot", [WS, volumeNameFor(WS), bad]));
      rejects(() => validateProviderCall("stopWorkspace", [bad]));
    }
    for (const bad of ["../../etc/passwd", "x.tar.gz", `${WS}__s$(id).tar.gz`]) {
      rejects(() => validateProviderCall("deleteSnapshot", [bad]));
    }
  });

  it("enforces the image allowlist and re-clamps limits", () => {
    rejects(() => validateProviderCall("createWorkspace", [spec({ image: "attacker/miner" })]));
    rejects(() => validateProviderCall("createWorkspace", [spec({ image: "--privileged" })]));
    const [sanitized] = validateProviderCall("createWorkspace", [spec({ limits: { cpus: 999, network: "host" }, extra: "dropped" })]) as [Record<string, unknown>];
    expect(sanitized.limits).toMatchObject({ cpus: 16, network: "bridge" });
    expect(sanitized).not.toHaveProperty("extra");
  });

  it("rejects bad homePath, exec env keys and out-of-range numbers", () => {
    rejects(() => validateProviderCall("createWorkspace", [spec({ homePath: "/x:/host" })]));
    rejects(() => validateProviderCall("createWorkspace", [spec({ homePath: "relative" })]));
    rejects(() => validateProviderCall("executeCommand", [{ workspaceId: WS, command: "ls", env: { "BAD KEY": "x" } }]));
    rejects(() => validateProviderCall("executeCommand", [{ workspaceId: WS, command: "ls", timeoutMs: 10 ** 9 }]));
    rejects(() => validateProviderCall("readFile", [WS, "/a", 10 ** 9]));
    rejects(() => validateProviderCall("killProcess", [WS, -1]));
    expect(validateProviderCall("executeCommand", [{ workspaceId: WS, command: "ls", env: { TOKEN: "x" } }])).toEqual([
      { workspaceId: WS, command: "ls", cwd: undefined, timeoutMs: undefined, env: { TOKEN: "x" }, stdin: undefined },
    ]);
  });
});

describe("runner signatures", () => {
  const now = 1_700_000_000_000;
  const headers = (body: string, path = "/v1/provider/getStatus", ts = now) => ({
    timestamp: String(ts), signature: signRunnerRequest(SECRET, String(ts), path, body),
  });

  it("accepts a fresh, correctly signed request", () => {
    expect(verifyRunnerRequest(SECRET, headers("{}"), "/v1/provider/getStatus", "{}", now)).toBe(true);
  });

  it("rejects a wrong secret, tampered body or path, and stale timestamps", () => {
    expect(verifyRunnerRequest("x".repeat(40), headers("{}"), "/v1/provider/getStatus", "{}", now)).toBe(false);
    expect(verifyRunnerRequest(SECRET, headers("{}"), "/v1/provider/getStatus", '{"a":1}', now)).toBe(false);
    expect(verifyRunnerRequest(SECRET, headers("{}"), "/v1/provider/destroyWorkspaceData", "{}", now)).toBe(false);
    expect(verifyRunnerRequest(SECRET, headers("{}", "/v1/provider/getStatus", now - 60_000), "/v1/provider/getStatus", "{}", now)).toBe(false);
    expect(verifyRunnerRequest(SECRET, { timestamp: null, signature: null }, "/", "{}", now)).toBe(false);
  });
});

describe("runner handler through the real client", () => {
  function setup() {
    const provider = {
      getStatus: vi.fn(async (id: string) => ({ runtimeId: "r", provider: "docker", state: "RUNNING", image: IMAGE, containerName: id })),
      destroyWorkspaceData: vi.fn(async () => undefined),
      stopWorkspace: vi.fn(async () => { throw new WorkspaceError("The workspace runtime is not running.", "runtime_not_running", "raw"); }),
      isAvailable: vi.fn(async () => { throw new Error("daemon exploded: /var/run/docker.sock secret detail"); }),
    } as unknown as WorkspaceRuntimeProvider;
    const handler = createRunnerHandler({
      secret: SECRET,
      provider,
      inspect: async (names) => names.map((name) => ({ Name: `/${name}`, State: { Running: true } })),
      logs: async () => ({ stdout: "a\nb", stderr: "" }),
    });
    const fetcher = ((url: string, init: RequestInit) => handler(new Request(url, init))) as typeof fetch;
    const client = new RunnerClient("http://runner", SECRET, fetcher);
    return { provider, handler, remote: new RemoteWorkspaceProvider(client), containers: new RemoteContainers(client) };
  }

  it("round-trips provider calls", async () => {
    const { remote, provider } = setup();
    expect(await remote.getStatus(WS)).toMatchObject({ state: "RUNNING", containerName: WS });
    expect(provider.getStatus).toHaveBeenCalledWith(WS);
  });

  it("preserves WorkspaceError code and status across the wire", async () => {
    const { remote } = setup();
    const error = await remote.stopWorkspace(WS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({ code: "runtime_not_running", status: 409 });
  });

  it("does not leak unclassified errors", async () => {
    const { handler } = setup();
    const body = JSON.stringify({ args: [] });
    const ts = String(Date.now());
    const res = await handler(new Request("http://runner/v1/provider/isAvailable", {
      method: "POST", body,
      headers: { [RUNNER_TIMESTAMP_HEADER]: ts, [RUNNER_SIGNATURE_HEADER]: signRunnerRequest(SECRET, ts, "/v1/provider/isAvailable", body) },
    }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("docker.sock");
  });

  it("refuses unsigned requests and unknown operations before touching the provider", async () => {
    const { handler, provider } = setup();
    const unsigned = await handler(new Request("http://runner/v1/provider/destroyWorkspaceData", {
      method: "POST", body: JSON.stringify({ args: ["sentinel-ws-data-x"] }),
    }));
    expect(unsigned.status).toBe(401);
    expect(provider.destroyWorkspaceData).not.toHaveBeenCalled();

    const client = new RunnerClient("http://runner", SECRET, ((url: string, init: RequestInit) => handler(new Request(url, init))) as typeof fetch);
    await expect(client.post("/v1/provider/constructor", { args: [] })).rejects.toMatchObject({ code: "not_implemented" });
    await expect(client.post("/v1/provider/destroyWorkspaceData", { args: ["postgres_data"] })).rejects.toMatchObject({ code: "policy_violation" });
    expect(provider.destroyWorkspaceData).not.toHaveBeenCalled();
  });

  it("serves inspect and logs with validated names", async () => {
    const { containers } = setup();
    expect(await containers.inspect(["hermes-lisa"])).toEqual([{ Name: "/hermes-lisa", State: { Running: true } }]);
    expect(await containers.logs("hermes-lisa", 10)).toEqual({ stdout: "a\nb", stderr: "" });
    await expect(containers.inspect(["--format={{json .}}"])).rejects.toMatchObject({ code: "invalid_body" });
    await expect(containers.logs("hermes-lisa", 10_000)).rejects.toMatchObject({ code: "invalid_body" });
  });

  it("reports an unreachable runner as unavailable", async () => {
    const client = new RunnerClient("http://runner", SECRET, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    expect(await new RemoteWorkspaceProvider(client).isAvailable()).toMatchObject({ available: false });
    await expect(new RemoteWorkspaceProvider(client).getStatus(WS)).rejects.toMatchObject({ code: "runtime_unavailable" });
  });
});

describe("inspect projection", () => {
  it("keeps what callers read and drops every other environment variable", () => {
    const projected = projectInspect({
      Name: "/app", RestartCount: 1, Image: "sha256:x",
      State: { Status: "running", Running: true, StartedAt: "t", Health: { Status: "healthy", Log: ["secret"] }, Pid: 7 },
      Config: {
        Image: "sentinel-os-app:abc", Labels: { "org.opencontainers.image.revision": "abc" },
        Env: ["SENTINEL_COMMIT=abc", "AUTH_SECRET=hunter2", "DATABASE_URL=postgresql://hermes:pw@postgres/db", "SENTINEL_BUILT_AT=t"],
      },
      HostConfig: { Binds: ["/var/run/docker.sock:/var/run/docker.sock"] },
    });
    expect(projected.Config?.Env).toEqual(["SENTINEL_COMMIT=abc", "SENTINEL_BUILT_AT=t"]);
    expect(JSON.stringify(projected)).not.toMatch(/hunter2|hermes:pw|docker\.sock|Pid/);
    expect(projected.State).toEqual({ Status: "running", Running: true, StartedAt: "t", Health: { Status: "healthy" } });
  });
});
