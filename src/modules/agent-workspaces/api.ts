"use client";

/** Typed client for the agent workspace API. One place that knows the routes. */

export type RuntimeState = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "STOPPING" | "ERROR";
export type DisplayState = RuntimeState | "ARCHIVED";

export interface WorkspaceSummary {
  id: string;
  agentId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  runtimeType: string;
  image: string;
  volumeName: string | null;
  homePath: string;
  locked: boolean;
  projectId: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  state: DisplayState;
  runtime: RuntimeRecord | null;
}

export interface RuntimeRecord {
  id: string;
  state: RuntimeState;
  containerId: string | null;
  containerName: string | null;
  image: string;
  startedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  reconciledAt: string | null;
}

export interface WorkspaceLimits {
  cpus: number; memoryMb: number; diskGb: number; pidsLimit: number;
  commandTimeoutMs: number; idleTimeoutMs: number; network: "none" | "bridge";
}

export interface WorkspaceDetail {
  workspace: WorkspaceSummary;
  identity: { workspaceId: string; agentId: string; runtimeId: string | null; ownerId: string; organizationId: string | null; tenantWorkspaceId: string };
  state: DisplayState;
  runtime: RuntimeRecord | null;
  stats: { cpuPercent: number | null; memoryBytes: number | null; memoryLimitBytes: number | null; diskUsedBytes: number | null; processCount: number | null; uptimeSeconds: number | null } | null;
  repository: { repository: string; branch: string | null; dirtyFiles: number } | null;
  limits: WorkspaceLimits;
  policy: { crossAgentDelegation: string; allowedRuntimeClients: string[] };
  counts: { snapshots: number; artifacts: number; runningProcesses: number };
  browserRuntime: { attached: boolean; provider: string | null; reason?: string };
}

export interface FileEntry { name: string; path: string; type: "file" | "directory" | "symlink"; sizeBytes: number; modifiedAt: string; mode: string }
export interface CommandRecord { id: string; command: string; cwd: string | null; status: string; exitCode: number | null; stdout: string; stderr: string; startedAt: string; durationMs: number | null; origin: string; agentId: string }
export interface ProcessRecord { id: string; label: string; command: string; pid: number | null; status: string; ports: number[]; startedAt: string; cwd: string | null }
export interface LiveProcess { pid: number; command: string; cpuPercent: number | null; memoryBytes: number | null; startedAt: string | null }
export interface SnapshotRecord { id: string; name: string; reason: string; status: string; sizeBytes: string | null; createdAt: string; restoredAt: string | null; gitState: Record<string, unknown> }
export interface ArtifactRecord { id: string; name: string; description: string | null; path: string; contentType: string; sizeBytes: string | null; pinned: boolean; createdAt: string }
export interface PermissionRecord { id: string; granteeAgentId: string | null; granteeUserId: string | null; level: string; reason: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string }
export interface EventRecord { id: string; type: string; severity: string; message: string; source: string; actorUserId: string | null; actorAgentId: string | null; occurredAt: string; metadata: Record<string, unknown> }

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText, code: "unknown" }));
    throw new ApiError(body.error ?? "Request failed", body.code ?? "unknown", response.status);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const base = (id: string) => `/api/agent-workspaces/${encodeURIComponent(id)}`;

export const workspaceApi = {
  list: (params: { agentId?: string } = {}) =>
    request<{ workspaces: WorkspaceSummary[] }>(`/api/agent-workspaces?${new URLSearchParams(params as Record<string, string>)}`),
  create: (body: Record<string, unknown>) =>
    request<{ workspace: WorkspaceSummary }>("/api/agent-workspaces", { method: "POST", body: JSON.stringify(body) }),
  detail: (id: string) => request<WorkspaceDetail>(base(id)),
  update: (id: string, body: Record<string, unknown>) =>
    request<{ workspace: WorkspaceSummary }>(base(id), { method: "PATCH", body: JSON.stringify(body) }),
  runtimeAction: (id: string, action: string) =>
    request<{ runtime: RuntimeRecord | null; workspace?: WorkspaceSummary }>(`${base(id)}/runtime`, { method: "POST", body: JSON.stringify({ action }) }),
  destroyRuntime: (id: string) => request<{ ok: boolean }>(`${base(id)}/runtime`, { method: "DELETE" }),
  deleteData: (id: string, confirmName: string) =>
    request<{ ok: boolean }>(`${base(id)}/data`, { method: "DELETE", body: JSON.stringify({ confirmName }) }),

  listFiles: (id: string, path?: string) =>
    request<{ path: string; entries: FileEntry[] }>(`${base(id)}/files?${new URLSearchParams(path ? { path } : {})}`),
  readFile: (id: string, path: string) =>
    request<{ path: string; content: string; encoding: string; sizeBytes: number }>(`${base(id)}/files?${new URLSearchParams({ path, mode: "read" })}`),
  writeFile: (id: string, path: string, content: string) =>
    request<{ path: string }>(`${base(id)}/files`, { method: "POST", body: JSON.stringify({ path, content, encoding: "utf8" }) }),
  deleteFile: (id: string, path: string, recursive: boolean) =>
    request<{ ok: boolean }>(`${base(id)}/files?${new URLSearchParams({ path, recursive: String(recursive) })}`, { method: "DELETE" }),

  commands: (id: string, limit = 50) => request<{ commands: CommandRecord[] }>(`${base(id)}/commands?limit=${limit}`),
  run: (id: string, command: string, cwd?: string) =>
    request<{ result: CommandRecord & { stdout: string; stderr: string; exitCode: number; commandId: string } }>(
      `${base(id)}/commands`, { method: "POST", body: JSON.stringify({ command, cwd }) },
    ),

  git: (id: string, body: Record<string, unknown>) =>
    request<{ result: { stdout: string; stderr: string; exitCode: number } }>(`${base(id)}/git`, { method: "POST", body: JSON.stringify(body) }),

  processes: (id: string) => request<{ live: LiveProcess[]; tracked: ProcessRecord[] }>(`${base(id)}/processes`),
  startProcess: (id: string, body: Record<string, unknown>) =>
    request<{ process: ProcessRecord }>(`${base(id)}/processes`, { method: "POST", body: JSON.stringify(body) }),
  stopProcess: (id: string, processId: string) =>
    request<{ process: ProcessRecord }>(`${base(id)}/processes/${processId}`, { method: "DELETE" }),
  processLogs: (id: string, processId: string) =>
    request<{ lines: string[] }>(`${base(id)}/processes/${processId}/logs`),

  snapshots: (id: string) => request<{ snapshots: SnapshotRecord[] }>(`${base(id)}/snapshots`),
  createSnapshot: (id: string, name: string, reason: string) =>
    request<{ snapshot: SnapshotRecord }>(`${base(id)}/snapshots`, { method: "POST", body: JSON.stringify({ name, reason }) }),
  restoreSnapshot: (id: string, snapshotId: string) =>
    request<{ snapshotId: string }>(`${base(id)}/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) }),
  deleteSnapshot: (id: string, snapshotId: string) =>
    request<{ ok: boolean }>(`${base(id)}/snapshots/${snapshotId}`, { method: "DELETE" }),
  compareSnapshots: (id: string, left: string, right: string) =>
    request<Record<string, unknown>>(`${base(id)}/snapshots/compare?${new URLSearchParams({ left, right })}`),

  artifacts: (id: string) => request<{ artifacts: ArtifactRecord[] }>(`${base(id)}/artifacts`),
  createArtifact: (id: string, path: string, name?: string) =>
    request<{ artifact: ArtifactRecord }>(`${base(id)}/artifacts`, { method: "POST", body: JSON.stringify({ path, name }) }),
  pinArtifact: (id: string, artifactId: string, pinned: boolean) =>
    request<{ artifact: ArtifactRecord }>(`${base(id)}/artifacts/${artifactId}`, { method: "PATCH", body: JSON.stringify({ pinned }) }),
  deleteArtifact: (id: string, artifactId: string) =>
    request<{ ok: boolean }>(`${base(id)}/artifacts/${artifactId}`, { method: "DELETE" }),
  artifactDownloadUrl: (id: string, artifactId: string) => `${base(id)}/artifacts/${artifactId}/content?download=true`,

  permissions: (id: string) => request<{ permissions: PermissionRecord[] }>(`${base(id)}/permissions`),
  grant: (id: string, body: Record<string, unknown>) =>
    request<{ permission: PermissionRecord }>(`${base(id)}/permissions`, { method: "POST", body: JSON.stringify(body) }),
  revoke: (id: string, grantId: string) =>
    request<{ permission: PermissionRecord }>(`${base(id)}/permissions/${grantId}`, { method: "DELETE" }),
  transfer: (id: string, body: Record<string, unknown>) =>
    request<{ workspace: WorkspaceSummary }>(`${base(id)}/transfer`, { method: "POST", body: JSON.stringify(body) }),
  clone: (id: string, body: Record<string, unknown>) =>
    request<{ workspace: WorkspaceSummary }>(`${base(id)}/clone`, { method: "POST", body: JSON.stringify(body) }),

  events: (id: string, limit = 100) => request<{ events: EventRecord[] }>(`${base(id)}/events?limit=${limit}`),

  browserCreate: (id: string) =>
    request<{ session: { sessionId: string; workspaceId: string; startedAt: string; currentUrl: string | null } }>(
      `${base(id)}/browser`, { method: "POST", body: JSON.stringify({ action: "create" }) },
    ),
  browserNavigate: (id: string, sessionId: string, url: string) =>
    request<{
      session: { sessionId: string; workspaceId: string; startedAt: string; currentUrl: string | null };
      navigation: { url: string; status: number };
    }>(`${base(id)}/browser`, { method: "POST", body: JSON.stringify({ action: "navigate", sessionId, url }) }),
  browserScreenshot: async (id: string, sessionId: string, fullPage = true) => {
    const response = await fetch(`${base(id)}/browser?${new URLSearchParams({ sessionId, fullPage: String(fullPage) })}`, { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText, code: "unknown" }));
      throw new ApiError(body.error ?? "Screenshot failed", body.code ?? "unknown", response.status);
    }
    return response.blob();
  },
  browserDownload: async (id: string, sessionId: string, url: string) => {
    const response = await fetch(`${base(id)}/browser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "download", sessionId, url }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText, code: "unknown" }));
      throw new ApiError(body.error ?? "Download failed", body.code ?? "unknown", response.status);
    }
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "download";
    return { blob: await response.blob(), filename };
  },
  browserClose: (id: string, sessionId: string) =>
    request<{ ok: boolean }>(`${base(id)}/browser?${new URLSearchParams({ sessionId })}`, { method: "DELETE" }),
  browserStatus: (id: string) =>
    request<{ attached: boolean; provider: string | null; reason?: string }>(`${base(id)}/browser?status=true`),
};
