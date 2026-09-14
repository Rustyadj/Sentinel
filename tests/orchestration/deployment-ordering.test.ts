import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Dispatch filters candidates on agent_runtimes.executionVerified, which
 * defaults to false. Any instance capable of dispatching work must therefore
 * start only after `migrate` has completed, or every run is rejected with "no
 * verified execution contract". This pins that ordering in compose so it cannot
 * regress silently.
 */
const compose = parse(readFileSync("docker-compose.yml", "utf8")) as {
  services: Record<string, { command?: string; depends_on?: Record<string, { condition?: string }> }>;
};

const DISPATCH_CAPABLE = ["app", "orchestration-worker"];

describe("deployment ordering for execution verification", () => {
  it.each(DISPATCH_CAPABLE)("%s waits for the migration job to complete successfully", (service) => {
    expect(compose.services[service], `${service} service is missing`).toBeDefined();
    expect(compose.services[service].depends_on?.migrate?.condition).toBe("service_completed_successfully");
  });

  it("runs migrations in a dedicated job rather than inside a serving container", () => {
    expect(compose.services.migrate?.command).toMatch(/prisma@?\d*\s+migrate\s+deploy/);
  });

  it("deploys a worker that actually consumes the orchestration queue", () => {
    // Without this service a route_task run is enqueued and never executed.
    expect(compose.services["orchestration-worker"]?.command).toMatch(/src\/workers\/orchestration-worker\.ts/);
  });

  it("gives the orchestration worker the Redis the queue lives on", () => {
    expect(compose.services["orchestration-worker"]?.depends_on?.redis?.condition).toBe("service_healthy");
  });
});
