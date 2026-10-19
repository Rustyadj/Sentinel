import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkspaceError } from "../errors";

const run = promisify(execFile);
const DOCKER_BIN = process.env.AGENT_WORKSPACE_DOCKER_BIN || "docker";

/**
 * Read-only container observation served by the workspace runner: what the
 * control plane (`docker inspect`) and the HTTP runtime adapter (`inspect`,
 * `logs`) used to ask the daemon for directly from the app.
 */
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const MAX_INSPECT_NAMES = 32;
export const MAX_LOG_LINES = 500;

/** The env keys callers read. Raw `docker inspect` returns every variable, secrets included. */
const FORWARDED_ENV = ["SENTINEL_RELEASE_SHA", "SENTINEL_COMMIT", "SENTINEL_BUILT_AT"];

export interface ProjectedInspect {
  Name?: string;
  RestartCount?: number;
  State?: { Status?: string; Running?: boolean; StartedAt?: string; Health?: { Status?: string } };
  Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string> };
  Image?: string;
}

export function projectInspect(payload: Record<string, unknown>): ProjectedInspect {
  const state = (payload.State ?? {}) as Record<string, unknown>;
  const config = (payload.Config ?? {}) as Record<string, unknown>;
  const health = state.Health as { Status?: string } | undefined;
  const env = Array.isArray(config.Env) ? (config.Env as string[]) : [];
  return {
    Name: payload.Name as string | undefined,
    RestartCount: payload.RestartCount as number | undefined,
    State: {
      Status: state.Status as string | undefined,
      Running: state.Running as boolean | undefined,
      StartedAt: state.StartedAt as string | undefined,
      ...(health ? { Health: { Status: health.Status } } : {}),
    },
    Config: {
      Image: config.Image as string | undefined,
      Labels: (config.Labels ?? {}) as Record<string, string>,
      Env: env.filter((entry) => FORWARDED_ENV.includes(entry.slice(0, entry.indexOf("=")))),
    },
    Image: payload.Image as string | undefined,
  };
}

export function assertContainerNames(names: unknown): string[] {
  if (!Array.isArray(names) || names.length === 0 || names.length > MAX_INSPECT_NAMES) {
    throw new WorkspaceError(`names must list 1-${MAX_INSPECT_NAMES} containers.`, "invalid_body");
  }
  return names.map((name) => assertContainerName(name));
}

export function assertContainerName(name: unknown): string {
  if (typeof name !== "string" || !CONTAINER_NAME.test(name)) {
    throw new WorkspaceError("Invalid container name.", "invalid_body");
  }
  return name;
}

function isMissing(error: unknown) {
  const stderr = (error as { stderr?: string }).stderr ?? "";
  return /no such (object|container)/i.test(stderr);
}

/**
 * Inspect each container separately so a missing one is omitted rather than
 * failing the whole request; any other failure (daemon down) throws, so it can
 * never be mistaken for "not running".
 */
export async function inspectContainersLocally(names: string[]): Promise<ProjectedInspect[]> {
  const found = await Promise.all(names.map(async (name) => {
    try {
      const { stdout } = await run(DOCKER_BIN, ["inspect", name], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 });
      return (JSON.parse(stdout) as Record<string, unknown>[]).map(projectInspect);
    } catch (error) {
      if (isMissing(error)) return [];
      throw new WorkspaceError("The Docker daemon could not be inspected.", "runtime_unavailable");
    }
  }));
  return found.flat();
}

export async function containerLogsLocally(name: string, tail: number): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(DOCKER_BIN, ["logs", "--tail", String(tail), name], {
      timeout: 8_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    if (isMissing(error)) throw new WorkspaceError("The container no longer exists.", "runtime_not_found");
    throw new WorkspaceError("Container logs are unavailable.", "runtime_unavailable");
  }
}
