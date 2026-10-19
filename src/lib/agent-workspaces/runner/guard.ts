import { WorkspaceError } from "../errors";
import {
  MAX_FILE_READ_BYTES, MAX_FILE_WRITE_BYTES, MAX_LIMITS,
  allowedWorkspaceImages, isSafeImageReference, parseLimits, resolveHomePath,
} from "../policy";
import { volumeNameFor } from "../providers/docker";
import type { CreateWorkspaceSpec, ExecRequest } from "../types";
import type { ProviderMethod } from "./protocol";

/**
 * Argument validation at the runner's trust boundary.
 *
 * The runner holds the Docker socket; the app does not. So the runner must not
 * trust the app's arguments any more than the app trusts a browser: a caller
 * that can only send what passes here can create, run and destroy *workspace*
 * containers and volumes, and nothing else on the host. In particular:
 *
 * - IDs are interpolated into container names and into the snapshot helper's
 *   `sh -c` script, so they are restricted to [A-Za-z0-9_-].
 * - A volume name must be the one the provider derives from the workspace ID.
 *   Otherwise `-v <volume>:<home>` could bind-mount a host path such as "/", and
 *   destroyWorkspaceData could remove any volume (e.g. the Postgres data).
 * - Images must be on the operator's allowlist; limits are re-clamped.
 *
 * Returns the arguments to pass to the provider, rebuilt from validated fields
 * so no unexpected property reaches it.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const WORKSPACE_VOLUME = /^sentinel-ws-data-[A-Za-z0-9_-]{1,64}$/;
const SNAPSHOT_REF = /^[A-Za-z0-9_-]{1,64}__[A-Za-z0-9_-]{1,64}\.tar\.gz$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_PATH = 4_096;
const MAX_COMMAND = 64 * 1024;
// Base64 inflates content by 4/3; allow for it on writes.
const MAX_WRITE_CONTENT = Math.ceil(MAX_FILE_WRITE_BYTES * 4 / 3) + 4;

function reject(message: string): never {
  throw new WorkspaceError(message, "policy_violation");
}

function id(value: unknown, field = "workspaceId"): string {
  if (typeof value !== "string" || !ID.test(value)) reject(`${field} is not a valid identifier.`);
  return value;
}

function str(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length > max) reject(`${field} must be a string of at most ${max} characters.`);
  return value;
}

function optStr(value: unknown, field: string, max: number): string | undefined {
  return value === undefined ? undefined : str(value, field, max);
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    reject(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") reject(`${field} must be a boolean.`);
  return value;
}

function volumeFor(workspaceId: string, value: unknown): string {
  if (value !== volumeNameFor(workspaceId)) reject("volumeName does not belong to this workspace.");
  return value as string;
}

function spec(value: unknown, withVolume: boolean): CreateWorkspaceSpec & { volumeName?: string } {
  if (!value || typeof value !== "object") reject("A workspace spec is required.");
  const raw = value as Record<string, unknown>;
  const workspaceId = id(raw.workspaceId);
  const image = str(raw.image, "image", 255);
  if (!isSafeImageReference(image) || !allowedWorkspaceImages().includes(image)) {
    reject("That workspace image is not on this host's allowlist.");
  }
  const homePath = str(raw.homePath, "homePath", 200);
  resolveHomePath(homePath); // throws on anything that is not a plain absolute path
  if (homePath.includes(":") || homePath.includes(",")) reject("homePath is not valid.");
  return {
    workspaceId,
    agentId: str(raw.agentId, "agentId", 200),
    image,
    homePath,
    limits: parseLimits(raw.limits),
    ...(withVolume ? { volumeName: volumeFor(workspaceId, raw.volumeName) } : {}),
  };
}

function execRequest(value: unknown): ExecRequest {
  if (!value || typeof value !== "object") reject("An exec request is required.");
  const raw = value as Record<string, unknown>;
  let env: Record<string, string> | undefined;
  if (raw.env !== undefined) {
    if (!raw.env || typeof raw.env !== "object" || Array.isArray(raw.env)) reject("env must be an object.");
    env = {};
    for (const [key, val] of Object.entries(raw.env as Record<string, unknown>)) {
      if (!ENV_KEY.test(key)) reject(`env key "${key.slice(0, 40)}" is not valid.`);
      env[key] = str(val, `env.${key}`, 64 * 1024);
    }
  }
  return {
    workspaceId: id(raw.workspaceId),
    command: str(raw.command, "command", MAX_COMMAND),
    cwd: optStr(raw.cwd, "cwd", MAX_PATH),
    timeoutMs: raw.timeoutMs === undefined ? undefined : int(raw.timeoutMs, "timeoutMs", 1, MAX_LIMITS.commandTimeoutMs),
    env,
    stdin: optStr(raw.stdin, "stdin", MAX_FILE_WRITE_BYTES),
  };
}

export function validateProviderCall(method: ProviderMethod, args: unknown): unknown[] {
  if (!Array.isArray(args)) reject("args must be an array.");
  const a = args;
  const path = (i: number, field = "path") => str(a[i], field, MAX_PATH);
  switch (method) {
    case "isAvailable":
      return [];
    case "createWorkspace":
      return [spec(a[0], false)];
    case "startWorkspace":
    case "restartWorkspace":
      return [spec(a[0], true)];
    case "stopWorkspace":
    case "pauseWorkspace":
    case "resumeWorkspace":
    case "getStatus":
    case "getStats":
    case "getProcesses":
    case "destroyRuntime":
      return [id(a[0])];
    case "executeCommand":
      return [execRequest(a[0])];
    case "readFile":
      return [id(a[0]), path(1), int(a[2], "maxBytes", 1, MAX_FILE_READ_BYTES)];
    case "writeFile": {
      const encoding = a[3];
      if (encoding !== "utf8" && encoding !== "base64") reject("encoding must be utf8 or base64.");
      return [id(a[0]), path(1), str(a[2], "content", MAX_WRITE_CONTENT), encoding];
    }
    case "listFiles":
      return [id(a[0]), path(1)];
    case "deletePath":
      return [id(a[0]), path(1), bool(a[2], "recursive")];
    case "movePath":
    case "copyPath":
      return [id(a[0]), path(1, "from"), path(2, "to")];
    case "searchFiles":
      return [id(a[0]), path(1, "root"), str(a[2], "query", 1_000), int(a[3], "limit", 1, 1_000)];
    case "killProcess":
      return [id(a[0]), int(a[1], "pid", 1, 4_194_304)];
    case "createSnapshot": {
      const workspaceId = id(a[0]);
      return [workspaceId, volumeFor(workspaceId, a[1]), id(a[2], "snapshotId")];
    }
    case "restoreSnapshot": {
      // The snapshot may belong to another workspace: handoff.ts restores a
      // source snapshot into a clone. Authorization for that is the app's.
      const workspaceId = id(a[0]);
      const storageRef = str(a[2], "storageRef", 200);
      if (!SNAPSHOT_REF.test(storageRef)) reject("Invalid snapshot reference.");
      return [workspaceId, volumeFor(workspaceId, a[1]), storageRef];
    }
    case "deleteSnapshot": {
      const storageRef = str(a[0], "storageRef", 200);
      if (!SNAPSHOT_REF.test(storageRef)) reject("Invalid snapshot reference.");
      return [storageRef];
    }
    case "destroyWorkspaceData": {
      const volumeName = str(a[0], "volumeName", 100);
      if (!WORKSPACE_VOLUME.test(volumeName)) reject("Only workspace data volumes can be destroyed.");
      return [volumeName];
    }
  }
}
