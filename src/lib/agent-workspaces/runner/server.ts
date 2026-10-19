import { WorkspaceError } from "../errors";
import type { WorkspaceRuntimeProvider } from "../types";
import {
  MAX_LOG_LINES, assertContainerName, assertContainerNames,
  type ProjectedInspect,
} from "./containers";
import { validateProviderCall } from "./guard";
import {
  RUNNER_MAX_BODY_BYTES, RUNNER_SIGNATURE_HEADER, RUNNER_TIMESTAMP_HEADER,
  isProviderMethod, toRunnerError, verifyRunnerRequest,
} from "./protocol";

export interface RunnerDependencies {
  secret: string;
  provider: WorkspaceRuntimeProvider;
  inspect(names: string[]): Promise<ProjectedInspect[]>;
  logs(name: string, tail: number): Promise<{ stdout: string; stderr: string }>;
}

const PROVIDER_PREFIX = "/v1/provider/";

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

/**
 * The workspace runner's whole HTTP surface:
 *
 *   GET  /healthz                    liveness only, reveals nothing
 *   POST /v1/provider/<method>       { args: [...] } -> { result }
 *   POST /v1/containers/inspect      { names: [...] } -> { containers }
 *   POST /v1/containers/logs         { name, tail }   -> { stdout, stderr }
 *
 * Everything but /healthz requires a valid signature, and every argument passes
 * the guard before it reaches Docker.
 */
export function createRunnerHandler(deps: RunnerDependencies) {
  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/healthz") return json(200, { ok: true });
    if (request.method !== "POST") return json(405, { error: { message: "Method not allowed.", code: "invalid_body" } });

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > RUNNER_MAX_BODY_BYTES) return json(413, { error: { message: "Request too large.", code: "file_too_large" } });
    const body = await request.text();
    if (Buffer.byteLength(body) > RUNNER_MAX_BODY_BYTES) {
      return json(413, { error: { message: "Request too large.", code: "file_too_large" } });
    }

    const signed = verifyRunnerRequest(deps.secret, {
      timestamp: request.headers.get(RUNNER_TIMESTAMP_HEADER),
      signature: request.headers.get(RUNNER_SIGNATURE_HEADER),
    }, pathname, body);
    if (!signed) return json(401, { error: { message: "Unauthorized.", code: "workspace_forbidden" } });

    try {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        throw new WorkspaceError("Body must be JSON.", "invalid_body");
      }

      if (pathname.startsWith(PROVIDER_PREFIX)) {
        const method = pathname.slice(PROVIDER_PREFIX.length);
        if (!isProviderMethod(method)) throw new WorkspaceError("Unknown runner operation.", "not_implemented");
        const args = validateProviderCall(method, payload.args);
        const call = deps.provider[method] as (...input: unknown[]) => Promise<unknown>;
        const result = await call.apply(deps.provider, args);
        return json(200, { result: result ?? null });
      }
      if (pathname === "/v1/containers/inspect") {
        return json(200, { containers: await deps.inspect(assertContainerNames(payload.names)) });
      }
      if (pathname === "/v1/containers/logs") {
        const tail = payload.tail;
        if (typeof tail !== "number" || !Number.isInteger(tail) || tail < 1 || tail > MAX_LOG_LINES) {
          throw new WorkspaceError(`tail must be 1-${MAX_LOG_LINES}.`, "invalid_body");
        }
        return json(200, await deps.logs(assertContainerName(payload.name), tail));
      }
      throw new WorkspaceError("Unknown runner operation.", "not_implemented");
    } catch (error) {
      const { status, body: errorBody } = toRunnerError(error);
      return json(status, errorBody);
    }
  };
}
