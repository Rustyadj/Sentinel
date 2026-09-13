/**
 * Errors surfaced from the Agent Workspace subsystem.
 *
 * Runtime backends (Docker today) produce noisy, implementation-specific
 * output. Users get a stable code plus a readable message; the raw backend
 * text is preserved on `detail` for admins and the event log only.
 */
export type WorkspaceErrorCode =
  | "workspace_not_found"
  | "workspace_archived"
  | "workspace_locked"
  | "workspace_forbidden"
  | "runtime_not_found"
  | "runtime_not_running"
  | "runtime_unavailable"
  | "runtime_start_failed"
  | "runtime_conflict"
  | "volume_missing"
  | "command_timeout"
  | "command_failed"
  | "path_escape"
  | "file_not_found"
  | "file_too_large"
  | "disk_full"
  | "snapshot_not_found"
  | "snapshot_failed"
  | "git_failed"
  | "invalid_body"
  | "policy_violation"
  | "not_implemented";

const STATUS_BY_CODE: Record<WorkspaceErrorCode, number> = {
  workspace_not_found: 404,
  workspace_archived: 409,
  workspace_locked: 409,
  workspace_forbidden: 403,
  runtime_not_found: 404,
  runtime_not_running: 409,
  runtime_unavailable: 503,
  runtime_start_failed: 500,
  runtime_conflict: 409,
  volume_missing: 500,
  command_timeout: 504,
  command_failed: 400,
  path_escape: 400,
  file_not_found: 404,
  file_too_large: 413,
  disk_full: 507,
  snapshot_not_found: 404,
  snapshot_failed: 500,
  git_failed: 400,
  invalid_body: 400,
  policy_violation: 403,
  not_implemented: 501,
};

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly status: number;
  /** Raw backend output. Never returned to non-admin callers. */
  readonly detail?: string;

  constructor(message: string, code: WorkspaceErrorCode, detail?: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }
}

/**
 * Map raw container-runtime stderr onto a stable Sentinel error. Anything
 * unrecognised becomes `runtime_unavailable` with the raw text kept as detail
 * rather than leaked into the message.
 */
export function translateRuntimeFailure(raw: string, fallback: WorkspaceErrorCode = "runtime_unavailable") {
  const text = raw.toLowerCase();
  if (text.includes("no such container")) {
    return new WorkspaceError("The workspace runtime container no longer exists.", "runtime_not_found", raw);
  }
  if (text.includes("no such volume") || text.includes("volume not found")) {
    return new WorkspaceError("The workspace data volume is missing.", "volume_missing", raw);
  }
  if (text.includes("is already in use") || text.includes("conflict")) {
    return new WorkspaceError("A runtime with this identity already exists.", "runtime_conflict", raw);
  }
  if (text.includes("no space left on device")) {
    return new WorkspaceError("The workspace ran out of disk space.", "disk_full", raw);
  }
  if (text.includes("cannot connect to the docker daemon") || text.includes("permission denied while trying to connect")) {
    return new WorkspaceError("The workspace runtime backend is unreachable.", "runtime_unavailable", raw);
  }
  if (text.includes("is not running")) {
    return new WorkspaceError("The workspace runtime is not running.", "runtime_not_running", raw);
  }
  return new WorkspaceError("The workspace runtime backend reported a failure.", fallback, raw);
}

export function workspaceErrorResponse(error: unknown) {
  if (error instanceof WorkspaceError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Error && error.name === "WorkspaceAccessError") {
    const status = (error as Error & { status?: number }).status ?? 403;
    return Response.json({ error: error.message, code: "workspace_forbidden" }, { status });
  }
  return Response.json({ error: "Internal error", code: "internal" }, { status: 500 });
}
