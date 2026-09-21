import { describe, expect, it } from "vitest";
import { observeRuntime, probeHealth, probeVersionEndpoint, type RuntimeSources } from "./runtime";
import { isObserved } from "./types";

const SHA = "e52761a0a9ba385e75cf508cbe46aeb672d89595";
const OTHER_SHA = "b83cc6ba9e0c164905ca964d42d5c3867b69f4e6";

/** One `docker inspect` entry, trimmed to the fields the observer reads. */
function inspectPayload(config: Record<string, unknown> = {}) {
  return [
    {
      Name: "/sentinel-os-app-1",
      RestartCount: 0,
      State: { Status: "running", StartedAt: "2026-09-20T15:00:00Z", Health: { Status: "healthy" } },
      Image: "sha256:abc123",
      Config: {
        Image: "sentinel-os-app",
        Env: [`SENTINEL_RELEASE_SHA=${SHA}`, "SENTINEL_BUILT_AT=2026-09-20T14:58:55Z"],
        Labels: { "com.docker.compose.project": "sentinel-os", "com.docker.compose.service": "app" },
        ...config,
      },
    },
  ];
}

/**
 * Fixed sources. The real ones are injected for exactly this reason — an
 * earlier version of this file mocked `node:child_process` instead, which does
 * not intercept a builtin imported by another module, so every assertion was
 * quietly being made against the live Docker daemon.
 */
function sources(options: { inspect?: unknown; version?: unknown; versionStatus?: number; healthStatus?: number; healthThrows?: boolean }): RuntimeSources {
  return {
    inspect: async () => JSON.stringify(options.inspect ?? []),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (options.healthThrows) throw new Error("ECONNREFUSED");
      if (url.includes("health")) return new Response("body", { status: options.healthStatus ?? 200 });
      return new Response(JSON.stringify(options.version ?? {}), {
        status: options.versionStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}

const production = { environment: "production", containerName: "sentinel-os-app-1", versionUrl: "http://app/api/version", healthUrl: null };

describe("probeVersionEndpoint", () => {
  it("does not treat the literal string 'unknown' as a commit", async () => {
    const result = await probeVersionEndpoint("http://app/api/version", sources({ version: { commit: "unknown", builtAt: "unknown" } }));

    expect(isObserved(result)).toBe(true);
    if (isObserved(result)) {
      expect(result.value.commit).toBeNull();
      expect(result.value.builtAt).toBeNull();
    }
  });

  it("reports a failed probe as unobserved rather than as a missing commit", async () => {
    const result = await probeVersionEndpoint("http://app/api/version", sources({ versionStatus: 502 }));

    expect(isObserved(result)).toBe(false);
    if (!isObserved(result)) expect(result.detail).toContain("502");
  });
});

describe("probeHealth", () => {
  it("separates a service reporting ill health from nothing answering at all", async () => {
    await expect(probeHealth("http://app/api/health", sources({ healthStatus: 503 }))).resolves.toMatchObject({
      status: "down",
      httpStatus: 503,
    });

    await expect(probeHealth("http://app/api/health", sources({ healthThrows: true }))).resolves.toMatchObject({
      status: "unreachable",
      httpStatus: null,
    });
  });
});

describe("observeRuntime", () => {
  it("corroborates the running revision when the container and the application agree", async () => {
    const result = await observeRuntime(production, sources({ inspect: inspectPayload(), version: { commit: SHA } }));

    expect(result.agreement).toBe("corroborated");
    expect(result.runningSha.value).toBe(SHA);
    expect(result.container?.health).toBe("healthy");
    expect(result.container?.composeService).toBe("app");
  });

  it("refuses to name a running revision when the two sources disagree", async () => {
    const result = await observeRuntime(production, sources({ inspect: inspectPayload(), version: { commit: OTHER_SHA } }));

    expect(result.agreement).toBe("conflicting");
    expect(result.runningSha.value).toBeNull();
    if (!isObserved(result.runningSha)) {
      expect(result.runningSha.detail).toContain("e52761a");
      expect(result.runningSha.detail).toContain("b83cc6b");
    }
  });

  it("does not call a short and a long form of the same commit a conflict", async () => {
    const result = await observeRuntime(production, sources({ inspect: inspectPayload(), version: { commit: SHA.slice(0, 7) } }));

    expect(result.agreement).toBe("corroborated");
    // The longer form is kept: same commit, more identifying information.
    expect(result.runningSha.value).toBe(SHA);
  });

  it("prefers the build-written OCI label over a deploy-written environment variable", async () => {
    const payload = inspectPayload({
      Env: [`SENTINEL_RELEASE_SHA=${OTHER_SHA}`],
      Labels: { "org.opencontainers.image.revision": SHA },
    });

    const result = await observeRuntime({ ...production, versionUrl: null }, sources({ inspect: payload }));

    expect(result.container?.shaSource).toBe("oci_label");
    expect(result.runningSha.value).toBe(SHA);
    expect(result.agreement).toBe("single_source");
  });

  it("reports an unidentifiable container as unknown instead of falling back to its image tag", async () => {
    const payload = inspectPayload({ Env: [], Labels: {} });

    const result = await observeRuntime({ ...production, versionUrl: null }, sources({ inspect: payload }));

    expect(result.container?.state).toBe("running");
    expect(result.container?.shaSource).toBe("none");
    expect(result.runningSha.value).toBeNull();
    expect(result.agreement).toBe("none");
  });

  it("ignores a malformed revision rather than displaying it as a commit", async () => {
    const payload = inspectPayload({ Env: ["SENTINEL_RELEASE_SHA=not-a-sha"], Labels: {} });

    const result = await observeRuntime({ ...production, versionUrl: null }, sources({ inspect: payload }));

    expect(result.container?.shaSource).toBe("none");
    expect(result.runningSha.value).toBeNull();
  });

  it("says which integration is missing when nothing is configured", async () => {
    const result = await observeRuntime(
      { environment: "staging", containerName: null, versionUrl: null, healthUrl: null },
      sources({}),
    );

    expect(result.container).toBeNull();
    if (!isObserved(result.version)) expect(result.version.missingIntegration).toBe("version endpoint");
    if (!isObserved(result.health)) expect(result.health.missingIntegration).toBe("health endpoint");
  });

  it("does not report a container that is not there", async () => {
    const result = await observeRuntime({ ...production, versionUrl: null }, sources({ inspect: [] }));

    expect(result.container).toBeNull();
    expect(result.agreement).toBe("none");
  });
});
