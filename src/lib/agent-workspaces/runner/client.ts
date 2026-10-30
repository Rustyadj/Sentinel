import { WorkspaceError } from "../errors";
import { DEFAULT_LIMITS } from "../policy";
import type {
  CreateWorkspaceSpec, ExecRequest, ExecResult, FileEntry, ProcessEntry,
  RuntimeDescriptor, RuntimeStats, SnapshotRef, WorkspaceRuntimeProvider,
} from "../types";
import type { ProjectedInspect } from "./containers";
import {
  RUNNER_SIGNATURE_HEADER, RUNNER_TIMESTAMP_HEADER,
  fromRunnerError, runnerSecret, signRunnerRequest, type ProviderMethod,
} from "./protocol";

/** Set WORKSPACE_RUNNER_URL to route every Docker operation through the runner. */
export function workspaceRunnerUrl(): string | null {
  return process.env.WORKSPACE_RUNNER_URL?.replace(/\/+$/, "") || null;
}

const DEFAULT_TIMEOUT_MS = 2 * 60_000;
// Snapshots tar whole volumes and starts may pull an image.
const LONG_TIMEOUT_MS = 15 * 60_000;
const LONG_METHODS = new Set<ProviderMethod>([
  "createWorkspace", "startWorkspace", "restartWorkspace", "createSnapshot", "restoreSnapshot",
]);

export class RunnerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async post<T>(path: string, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RUNNER_TIMESTAMP_HEADER]: timestamp,
          [RUNNER_SIGNATURE_HEADER]: signRunnerRequest(this.secret, timestamp, path, body),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error)?.name === "TimeoutError";
      throw new WorkspaceError(
        timedOut ? "The workspace runner did not respond in time." : "The workspace runner is unreachable.",
        timedOut ? "command_timeout" : "runtime_unavailable",
      );
    }
    const parsed = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw fromRunnerError(parsed);
    return parsed as T;
  }
}

/**
 * The app-side WorkspaceRuntimeProvider when the runner is enabled. It keeps
 * the "docker" id: rows record the backend type, and the backend is still
 * Docker — only the process that talks to it has moved.
 */
export class RemoteWorkspaceProvider implements WorkspaceRuntimeProvider {
  readonly id = "docker" as const;

  constructor(private readonly client: RunnerClient) {}

  private async call<T>(method: ProviderMethod, args: unknown[], timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs ?? (LONG_METHODS.has(method) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    const { result } = await this.client.post<{ result: T }>(`/v1/provider/${method}`, { args }, timeout);
    return result;
  }

  createWorkspace(spec: CreateWorkspaceSpec) { return this.call<{ volumeName: string }>("createWorkspace", [spec]); }
  startWorkspace(spec: CreateWorkspaceSpec & { volumeName: string }) { return this.call<RuntimeDescriptor>("startWorkspace", [spec]); }
  stopWorkspace(workspaceId: string) { return this.call<RuntimeDescriptor>("stopWorkspace", [workspaceId]); }
  pauseWorkspace(workspaceId: string) { return this.call<RuntimeDescriptor>("pauseWorkspace", [workspaceId]); }
  resumeWorkspace(workspaceId: string) { return this.call<RuntimeDescriptor>("resumeWorkspace", [workspaceId]); }
  restartWorkspace(spec: CreateWorkspaceSpec & { volumeName: string }) { return this.call<RuntimeDescriptor>("restartWorkspace", [spec]); }
  getStatus(workspaceId: string) { return this.call<RuntimeDescriptor | null>("getStatus", [workspaceId]); }
  getStats(workspaceId: string) { return this.call<RuntimeStats>("getStats", [workspaceId]); }

  executeCommand(request: ExecRequest) {
    // The command's own timeout plus headroom for the runner round trip.
    const timeout = (request.timeoutMs ?? DEFAULT_LIMITS.commandTimeoutMs) + 30_000;
    return this.call<ExecResult>("executeCommand", [request], timeout);
  }

  readFile(workspaceId: string, path: string, maxBytes: number) {
    return this.call<{ content: string; encoding: "utf8" | "base64"; sizeBytes: number }>("readFile", [workspaceId, path, maxBytes]);
  }
  async writeFile(workspaceId: string, path: string, content: string, encoding: "utf8" | "base64") {
    await this.call("writeFile", [workspaceId, path, content, encoding]);
  }
  listFiles(workspaceId: string, path: string) { return this.call<FileEntry[]>("listFiles", [workspaceId, path]); }
  async deletePath(workspaceId: string, path: string, recursive: boolean) { await this.call("deletePath", [workspaceId, path, recursive]); }
  async movePath(workspaceId: string, from: string, to: string) { await this.call("movePath", [workspaceId, from, to]); }
  async copyPath(workspaceId: string, from: string, to: string) { await this.call("copyPath", [workspaceId, from, to]); }
  searchFiles(workspaceId: string, root: string, query: string, limit: number) {
    return this.call<{ path: string; line: number; text: string }[]>("searchFiles", [workspaceId, root, query, limit]);
  }

  getProcesses(workspaceId: string) { return this.call<ProcessEntry[]>("getProcesses", [workspaceId]); }
  async killProcess(workspaceId: string, pid: number) { await this.call("killProcess", [workspaceId, pid]); }

  createSnapshot(workspaceId: string, volumeName: string, snapshotId: string) {
    return this.call<SnapshotRef>("createSnapshot", [workspaceId, volumeName, snapshotId]);
  }
  async restoreSnapshot(workspaceId: string, volumeName: string, storageRef: string) {
    await this.call("restoreSnapshot", [workspaceId, volumeName, storageRef]);
  }
  async deleteSnapshot(storageRef: string) { await this.call("deleteSnapshot", [storageRef]); }

  async destroyRuntime(workspaceId: string) { await this.call("destroyRuntime", [workspaceId]); }
  async destroyWorkspaceData(volumeName: string) { await this.call("destroyWorkspaceData", [volumeName]); }

  async isAvailable() {
    try {
      return await this.call<{ available: boolean; reason?: string }>("isAvailable", []);
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : "workspace runner unavailable" };
    }
  }
}

/** Container inspect/logs through the runner, for callers outside the workspace provider. */
export class RemoteContainers {
  constructor(private readonly client: RunnerClient) {}

  async inspect(names: string[]): Promise<ProjectedInspect[]> {
    const { containers } = await this.client.post<{ containers: ProjectedInspect[] }>("/v1/containers/inspect", { names });
    return containers;
  }

  logs(name: string, tail: number) {
    return this.client.post<{ stdout: string; stderr: string }>("/v1/containers/logs", { name, tail });
  }
}

let shared: RunnerClient | null = null;

/** The configured runner client, or null when the app talks to Docker itself. */
export function runnerClient(): RunnerClient | null {
  const url = workspaceRunnerUrl();
  if (!url) return null;
  shared ??= new RunnerClient(url, runnerSecret());
  return shared;
}
