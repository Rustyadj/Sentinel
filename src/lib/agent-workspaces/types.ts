/**
 * Backend-neutral contracts for the Agent Workspace subsystem.
 *
 * Nothing in this file may reference Docker. Docker (and any future
 * Kubernetes / Firecracker / remote-VPS backend) lives behind
 * `WorkspaceRuntimeProvider`.
 */

export type RuntimeState =
  | "STOPPED"
  | "STARTING"
  | "RUNNING"
  | "PAUSED"
  | "STOPPING"
  | "ERROR";

/** Data lifecycle, deliberately separate from RuntimeState. */
export type WorkspaceStatus = "ACTIVE" | "ARCHIVED" | "DELETED";

/** The combined state Sentinel shows operators. */
export type WorkspaceDisplayState = RuntimeState | "ARCHIVED";

export type RuntimeProviderId = "docker";

/** Which client asked for the work. Never inferred — always passed explicitly. */
export type RuntimeClient = "hermes" | "claude-code" | "codex" | "sentinel-ui" | "system";

export interface WorkspaceIdentity {
  workspaceId: string;
  agentId: string;
  runtimeId: string | null;
  ownerId: string;
  organizationId: string | null;
  tenantWorkspaceId: string;
}

export interface WorkspaceResourceLimits {
  cpus: number;
  memoryMb: number;
  diskGb: number;
  pidsLimit: number;
  commandTimeoutMs: number;
  idleTimeoutMs: number;
  /** "none" = no egress at all; "bridge" = default egress. */
  network: "none" | "bridge";
}

export interface WorkspacePolicy {
  /**
   * Governs whether one runtime client may hand work to another inside this
   * workspace. "explicit-only" (the default) means Claude Code and Codex never
   * delegate to each other unless the operator authorises that specific run.
   */
  crossAgentDelegation: "explicit-only" | "allowed" | "denied";
  allowedRuntimeClients: RuntimeClient[];
}

export interface RuntimeDescriptor {
  runtimeId: string;
  provider: RuntimeProviderId;
  state: RuntimeState;
  containerId?: string;
  containerName?: string;
  image: string;
  startedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RuntimeStats {
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  diskUsedBytes: number | null;
  processCount: number | null;
  uptimeSeconds: number | null;
}

export interface CreateWorkspaceSpec {
  workspaceId: string;
  agentId: string;
  image: string;
  homePath: string;
  limits: WorkspaceResourceLimits;
}

export interface ExecRequest {
  workspaceId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  /** Secrets injected at exec time. Never written into the image or volume. */
  env?: Record<string, string>;
  stdin?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  sizeBytes: number;
  modifiedAt: string;
  mode: string;
}

export interface ProcessEntry {
  pid: number;
  command: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  startedAt: string | null;
}

export interface SnapshotRef {
  storageRef: string;
  sizeBytes: number;
}

/**
 * The single seam every runtime backend implements. Adding Kubernetes or a
 * remote VPS means adding one implementation here — not touching services,
 * API routes or UI.
 */
export interface WorkspaceRuntimeProvider {
  readonly id: RuntimeProviderId;

  /** Provision durable storage. Idempotent; never starts compute. */
  createWorkspace(spec: CreateWorkspaceSpec): Promise<{ volumeName: string }>;
  startWorkspace(spec: CreateWorkspaceSpec & { volumeName: string }): Promise<RuntimeDescriptor>;
  stopWorkspace(workspaceId: string): Promise<RuntimeDescriptor>;
  pauseWorkspace(workspaceId: string): Promise<RuntimeDescriptor>;
  resumeWorkspace(workspaceId: string): Promise<RuntimeDescriptor>;
  restartWorkspace(spec: CreateWorkspaceSpec & { volumeName: string }): Promise<RuntimeDescriptor>;
  /** Observed truth from the backend — never an echo of the database. */
  getStatus(workspaceId: string): Promise<RuntimeDescriptor | null>;
  getStats(workspaceId: string): Promise<RuntimeStats>;

  executeCommand(request: ExecRequest): Promise<ExecResult>;

  readFile(workspaceId: string, path: string, maxBytes: number): Promise<{ content: string; encoding: "utf8" | "base64"; sizeBytes: number }>;
  writeFile(workspaceId: string, path: string, content: string, encoding: "utf8" | "base64"): Promise<void>;
  listFiles(workspaceId: string, path: string): Promise<FileEntry[]>;
  deletePath(workspaceId: string, path: string, recursive: boolean): Promise<void>;
  movePath(workspaceId: string, from: string, to: string): Promise<void>;
  copyPath(workspaceId: string, from: string, to: string): Promise<void>;
  searchFiles(workspaceId: string, root: string, query: string, limit: number): Promise<{ path: string; line: number; text: string }[]>;

  getProcesses(workspaceId: string): Promise<ProcessEntry[]>;
  killProcess(workspaceId: string, pid: number): Promise<void>;

  /** Snapshots operate on the data volume and work while the runtime is down. */
  createSnapshot(workspaceId: string, volumeName: string, snapshotId: string): Promise<SnapshotRef>;
  restoreSnapshot(workspaceId: string, volumeName: string, storageRef: string): Promise<void>;
  deleteSnapshot(storageRef: string): Promise<void>;

  /** Tears down compute only. Must never touch the data volume. */
  destroyRuntime(workspaceId: string): Promise<void>;
  /** Explicit, separately authorised destruction of workspace data. */
  destroyWorkspaceData(volumeName: string): Promise<void>;

  isAvailable(): Promise<{ available: boolean; reason?: string }>;
}
