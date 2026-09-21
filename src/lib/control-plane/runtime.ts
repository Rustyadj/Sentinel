import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isObserved,
  observed,
  unobserved,
  type ContainerObservation,
  type HealthProbeObservation,
  type Maybe,
  type RuntimeObservation,
  type ShaSource,
  type SourceAgreement,
  type VersionEndpointObservation,
} from "./types";

const run = promisify(execFile);

const DOCKER_BIN = process.env.AGENT_WORKSPACE_DOCKER_BIN || "docker";
const DOCKER_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 4_000;

/** Truncated so a misbehaving endpoint cannot push an essay into the UI. */
const MAX_DETAIL_CHARS = 280;

/**
 * The OCI standard label for the commit an image was built from. Written by
 * the build, which makes it the strongest revision claim available here: unlike
 * a baked environment variable it cannot survive a rebuild unchanged.
 */
const REVISION_LABEL = "org.opencontainers.image.revision";

function isFullSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

/**
 * Where a runtime observation gets its facts.
 *
 * Injected rather than imported directly for two reasons. The containers
 * Sentinel cares about will not all be on the machine running Sentinel — a
 * second VPS or a remote daemon needs a different inspector behind the same
 * observation logic. And it makes the reconciliation rules testable against
 * fixed inputs, which mocking `node:child_process` does not reliably achieve:
 * builtins imported by *another* module are externalised, so a module mock in
 * a test file silently leaves the real daemon in place and the test passes by
 * coincidence. That happened while writing this file.
 */
export interface RuntimeSources {
  /** Raw `docker inspect` JSON for the named containers. */
  inspect(names: string[]): Promise<string>;
  fetch: typeof fetch;
}

export const localDockerSources: RuntimeSources = {
  async inspect(names) {
    // execFile with an argv array: container names come from the database and
    // are never allowed to become docker flags or shell input.
    const { stdout } = await run(DOCKER_BIN, ["inspect", ...names], {
      timeout: DOCKER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  },
  fetch: (...args) => fetch(...args),
};

interface InspectPayload {
  Name?: string;
  RestartCount?: number;
  State?: { Status?: string; StartedAt?: string; Health?: { Status?: string } };
  Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string> };
  Image?: string;
}

function envValue(env: string[] | undefined, key: string): string | null {
  const match = env?.find((entry) => entry.startsWith(`${key}=`));
  return match ? match.slice(key.length + 1) || null : null;
}

/**
 * Pick the revision claim and say where it came from, strongest first. When
 * nothing identifies the revision the result is `not_observed` rather than a
 * guess — a container whose SHA is unknown is a real and reportable state, and
 * showing the image tag in its place would read as confirmation.
 */
function resolveSha(payload: InspectPayload): { sha: Maybe<string>; source: ShaSource } {
  const candidates: Array<[ShaSource, string | null]> = [
    ["oci_label", payload.Config?.Labels?.[REVISION_LABEL] ?? null],
    ["env_release_sha", envValue(payload.Config?.Env, "SENTINEL_RELEASE_SHA")],
    ["env_commit", envValue(payload.Config?.Env, "SENTINEL_COMMIT")],
  ];

  for (const [source, value] of candidates) {
    if (value && isFullSha(value)) return { sha: observed(value.trim(), `docker:${source}`), source };
  }

  return {
    sha: unobserved("not_observed", undefined, "The container declares no commit label or release SHA."),
    source: "none",
  };
}

/**
 * Inspect named containers. Missing containers are omitted rather than
 * fabricated: "not running" is derived by the caller from the absence, so a
 * daemon that is unreachable can never be mistaken for a service that is down.
 * That distinction is why a docker failure throws instead of returning [].
 */
export async function observeContainers(
  names: string[],
  sources: RuntimeSources = localDockerSources,
): Promise<ContainerObservation[]> {
  if (names.length === 0) return [];

  const raw = await sources.inspect(names).catch(async () => {
    // `docker inspect` exits non-zero when *any* name is missing, but still
    // prints the ones it found. Retry individually so one removed container
    // does not blank out every other environment.
    if (names.length === 1) return "";
    const found = await Promise.all(names.map((name) => sources.inspect([name]).catch((): string => "")));
    const merged = found.flatMap((value) => (value.trim() ? (JSON.parse(value) as InspectPayload[]) : []));
    return JSON.stringify(merged);
  });

  if (!raw.trim()) return [];
  const payloads = JSON.parse(raw) as InspectPayload[];
  const observedAt = new Date().toISOString();

  return payloads.map((payload) => {
    const { sha, source } = resolveSha(payload);
    const labels = payload.Config?.Labels ?? {};
    return {
      name: (payload.Name ?? "").replace(/^\//, ""),
      state: payload.State?.Status ?? "unknown",
      health: (payload.State?.Health?.Status as ContainerObservation["health"]) ?? "none",
      image: payload.Config?.Image ?? "",
      imageDigest: payload.Image ?? null,
      startedAt: payload.State?.StartedAt ?? null,
      restartCount: payload.RestartCount ?? 0,
      sha,
      shaSource: source,
      builtAt: envValue(payload.Config?.Env, "SENTINEL_BUILT_AT"),
      composeProject: labels["com.docker.compose.project"] ?? null,
      composeService: labels["com.docker.compose.service"] ?? null,
      observedAt,
    };
  });
}

/**
 * Ask the running application what it thinks it is. This is independent of the
 * container's metadata — it is the build's own answer, served by the process
 * actually handling requests — which is exactly what makes it worth collecting
 * separately rather than trusting one source twice.
 */
export async function probeVersionEndpoint(
  url: string,
  sources: RuntimeSources = localDockerSources,
): Promise<Maybe<VersionEndpointObservation>> {
  try {
    const response = await sources.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) {
      return unobserved("command_failed", undefined, `${url} returned ${response.status}.`);
    }
    const body = (await response.json()) as { commit?: string; builtAt?: string; environment?: string };
    const commit = typeof body.commit === "string" && body.commit !== "unknown" ? body.commit : null;
    return observed(
      {
        url,
        commit,
        builtAt: body.builtAt && body.builtAt !== "unknown" ? body.builtAt : null,
        environment: body.environment ?? null,
        observedAt: new Date().toISOString(),
      },
      "version_endpoint",
    );
  } catch (error) {
    return unobserved("command_failed", undefined, error instanceof Error ? error.message : "Version probe failed.");
  }
}

/**
 * Probe a health endpoint. An unreachable endpoint is reported as
 * `unreachable`, never as `down`: the difference between "the service says it
 * is unwell" and "nothing answered" is the difference between a broken
 * application and a broken network path, and an operator acts on them
 * differently.
 */
export async function probeHealth(
  url: string,
  sources: RuntimeSources = localDockerSources,
): Promise<HealthProbeObservation> {
  const startedAt = Date.now();
  try {
    const response = await sources.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const latencyMs = Date.now() - startedAt;
    const text = (await response.text()).slice(0, MAX_DETAIL_CHARS);
    return {
      url,
      status: response.ok ? "ok" : response.status >= 500 ? "down" : "degraded",
      httpStatus: response.status,
      latencyMs,
      detail: text || null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      url,
      status: "unreachable",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message.slice(0, MAX_DETAIL_CHARS) : null,
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * Two sources agreeing is stronger evidence than one; two disagreeing is the
 * most important thing the control plane can say. A conflict means the
 * container was replaced without its metadata being updated, or the endpoint is
 * serving a constant baked at an earlier build — either way the deployment is
 * not what it claims, and no SHA is asserted until a human resolves it.
 */
function reconcile(
  container: ContainerObservation | null,
  version: Maybe<VersionEndpointObservation>,
): { runningSha: Maybe<string>; agreement: SourceAgreement } {
  const containerSha = container && isObserved(container.sha) ? container.sha.value : null;
  const endpointSha = isObserved(version) ? version.value.commit : null;

  if (containerSha && endpointSha) {
    // One source may report a short SHA and the other a full one; comparing by
    // prefix avoids reporting a false conflict between two identical commits.
    const shorter = Math.min(containerSha.length, endpointSha.length);
    const same = containerSha.slice(0, shorter).toLowerCase() === endpointSha.slice(0, shorter).toLowerCase();
    if (!same) {
      return {
        runningSha: unobserved(
          "not_observed",
          undefined,
          `Container reports ${containerSha.slice(0, 7)} but the running application reports ${endpointSha.slice(0, 7)}.`,
        ),
        agreement: "conflicting",
      };
    }
    // Prefer whichever is longer: same commit, more identifying information.
    const value = containerSha.length >= endpointSha.length ? containerSha : endpointSha;
    return { runningSha: observed(value, "docker+version_endpoint"), agreement: "corroborated" };
  }

  if (containerSha) return { runningSha: observed(containerSha, `docker:${container?.shaSource}`), agreement: "single_source" };
  if (endpointSha) return { runningSha: observed(endpointSha, "version_endpoint"), agreement: "single_source" };

  return {
    runningSha: unobserved("not_observed", undefined, "No source identified the running revision."),
    agreement: "none",
  };
}

export interface RuntimeTarget {
  environment: string;
  containerName: string | null;
  versionUrl: string | null;
  healthUrl: string | null;
}

/** Assemble one environment from every source that has something to say. */
export async function observeRuntime(
  target: RuntimeTarget,
  sources: RuntimeSources = localDockerSources,
): Promise<RuntimeObservation> {
  const [containers, version, health] = await Promise.all([
    target.containerName ? observeContainers([target.containerName], sources).catch(() => []) : Promise.resolve([]),
    target.versionUrl
      ? probeVersionEndpoint(target.versionUrl, sources)
      : Promise.resolve(unobserved("not_configured", "version endpoint", "No version URL is configured for this environment.")),
    target.healthUrl
      ? probeHealth(target.healthUrl, sources).then((value) => observed(value, "health_probe"))
      : Promise.resolve(null),
  ]);

  const container = containers[0] ?? null;
  const { runningSha, agreement } = reconcile(container, version);

  return {
    environment: target.environment,
    container,
    version,
    health:
      health ??
      unobserved("not_configured", "health endpoint", "No health URL is configured for this environment."),
    runningSha,
    agreement,
    observedAt: new Date().toISOString(),
  };
}
