import { createHmac, timingSafeEqual } from "node:crypto";
import { WorkspaceError, isWorkspaceErrorCode, type WorkspaceErrorCode } from "../errors";
import type { WorkspaceRuntimeProvider } from "../types";

/**
 * Wire protocol between the app and the workspace runner — the one process
 * that holds the host Docker socket (docs/SECURITY_REMEDIATION.md §3).
 *
 * Every request is HMAC-SHA256 signed over `${timestamp}.${path}.${body}` with
 * WORKSPACE_RUNNER_SECRET and rejected outside a short clock window. The runner
 * listens only on the internal compose network; the signature makes a request
 * from any other container on that network worthless, and the window bounds
 * replay of a captured one.
 */
export const RUNNER_SIGNATURE_HEADER = "x-sentinel-runner-signature";
export const RUNNER_TIMESTAMP_HEADER = "x-sentinel-runner-timestamp";
export const RUNNER_MAX_SKEW_MS = 30_000;
export const RUNNER_MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Provider operations the runner will perform. Exactly the provider interface, nothing else. */
export const PROVIDER_METHODS = [
  "createWorkspace", "startWorkspace", "stopWorkspace", "pauseWorkspace", "resumeWorkspace",
  "restartWorkspace", "getStatus", "getStats", "executeCommand",
  "readFile", "writeFile", "listFiles", "deletePath", "movePath", "copyPath", "searchFiles",
  "getProcesses", "killProcess", "createSnapshot", "restoreSnapshot", "deleteSnapshot",
  "destroyRuntime", "destroyWorkspaceData", "isAvailable",
] as const satisfies ReadonlyArray<Exclude<keyof WorkspaceRuntimeProvider, "id">>;

export type ProviderMethod = (typeof PROVIDER_METHODS)[number];

export function isProviderMethod(value: string): value is ProviderMethod {
  return (PROVIDER_METHODS as readonly string[]).includes(value);
}

export function runnerSecret(): string {
  const secret = process.env.WORKSPACE_RUNNER_SECRET ?? "";
  // A short secret would make the signature the weakest link to host root.
  if (secret.length < 32) throw new Error("WORKSPACE_RUNNER_SECRET must be set to at least 32 characters.");
  return secret;
}

export function signRunnerRequest(secret: string, timestamp: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${path}.${body}`).digest("base64url");
}

export function verifyRunnerRequest(
  secret: string,
  headers: { timestamp: string | null; signature: string | null },
  path: string,
  body: string,
  now = Date.now(),
): boolean {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature || !/^\d{1,15}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > RUNNER_MAX_SKEW_MS) return false;
  const expected = Buffer.from(signRunnerRequest(secret, timestamp, path, body));
  const provided = Buffer.from(signature);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export interface RunnerErrorBody {
  error: { message: string; code: WorkspaceErrorCode; detail?: string };
}

/**
 * WorkspaceErrors cross the wire intact so routes map them to the same status
 * and message as before. Anything else is reduced to a generic error: the
 * runner never returns stack traces or unclassified daemon output.
 */
export function toRunnerError(error: unknown): { status: number; body: RunnerErrorBody } {
  if (error instanceof WorkspaceError) {
    return { status: error.status, body: { error: { message: error.message, code: error.code, detail: error.detail } } };
  }
  return { status: 500, body: { error: { message: "The workspace runner failed to complete the operation.", code: "runtime_unavailable" } } };
}

export function fromRunnerError(body: unknown): WorkspaceError {
  const error = (body as Partial<RunnerErrorBody> | null)?.error;
  if (error && typeof error.message === "string" && isWorkspaceErrorCode(error.code)) {
    return new WorkspaceError(error.message, error.code, typeof error.detail === "string" ? error.detail : undefined);
  }
  return new WorkspaceError("The workspace runner returned an unexpected response.", "runtime_unavailable");
}
