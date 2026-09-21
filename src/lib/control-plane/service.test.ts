import { describe, expect, it, vi } from "vitest";
import { buildControlPlaneData, parseDeployTargets, type ControlPlaneDependencies, type RegisteredRepository } from "./service";
import { GitObservationError } from "./git";
import { observed, unobserved, type GitObservation, type RuntimeObservation } from "./types";

const HEAD_SHA = "a".repeat(40);

function gitObservation(overrides: Partial<GitObservation> = {}): GitObservation {
  return {
    path: "/repos/example",
    branch: "main",
    detached: false,
    head: { sha: HEAD_SHA, shortSha: "aaaaaaa", subject: "initial", author: "Test", committedAt: "2026-09-20T12:00:00Z" },
    workingTree: { modified: [], staged: [], untracked: [], changedFileCount: 0, truncated: false, clean: true },
    upstream: observed({ ref: "origin/main", ahead: 0, behind: 0, remoteSha: HEAD_SHA }, "git"),
    remoteUrl: "git@example:acme/example.git",
    defaultBranch: "main",
    defaultBranchSource: "remote_ref",
    defaultBranchSha: observed(HEAD_SHA, "git"),
    remoteRefsFetchedAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

function runtimeObservation(environment: string): RuntimeObservation {
  return {
    environment,
    container: null,
    version: unobserved("not_configured", "version endpoint"),
    health: unobserved("not_configured", "health endpoint"),
    runningSha: observed(HEAD_SHA, "docker:env_release_sha"),
    agreement: "single_source",
    observedAt: new Date().toISOString(),
  };
}

function repository(overrides: Partial<RegisteredRepository> = {}): RegisteredRepository {
  return { id: "repo-1", name: "Example", localPath: "/repos/example", host: "local", deployTargets: [], ...overrides };
}

function dependencies(overrides: Partial<ControlPlaneDependencies> = {}): ControlPlaneDependencies {
  return {
    observeGit: vi.fn(async () => gitObservation()) as unknown as ControlPlaneDependencies["observeGit"],
    observeRuntimeTarget: vi.fn(async (target: { environment: string }) =>
      runtimeObservation(target.environment),
    ) as unknown as ControlPlaneDependencies["observeRuntimeTarget"],
    ...overrides,
  };
}

describe("parseDeployTargets", () => {
  it("keeps well-formed targets and drops the rest without throwing", () => {
    const targets = parseDeployTargets([
      { environment: "production", containerName: "app-1", versionUrl: "http://app/api/version" },
      { containerName: "orphan" },
      "nonsense",
      null,
    ]);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ environment: "production", containerName: "app-1", healthUrl: null });
  });

  it("treats a malformed column as no targets rather than failing the page", () => {
    expect(parseDeployTargets("{}")).toEqual([]);
    expect(parseDeployTargets(null)).toEqual([]);
  });
});

describe("buildControlPlaneData", () => {
  it("still draws the rail for a repository that is deployed nowhere", async () => {
    const data = await buildControlPlaneData([repository()], dependencies());

    expect(data.positions).toHaveLength(1);
    const [position] = data.positions;
    expect(position.stages.find((stage) => stage.id === "committed")?.state).toBe("reached");
    // The half that depends on a deployment is unconfigured, not "nothing deployed".
    expect(position.stages.find((stage) => stage.id === "deployed")?.state).toBe("not_reached");
    expect(data.problems).toEqual([]);
  });

  it("produces one rail per configured environment", async () => {
    const data = await buildControlPlaneData(
      [repository({ deployTargets: [{ environment: "production", containerName: "app-1" }, { environment: "staging", containerName: "app-staging" }] })],
      dependencies(),
    );

    expect(data.positions.map((position) => position.environment)).toEqual(["production", "staging"]);
  });

  it("reports an unreadable repository instead of omitting it", async () => {
    const data = await buildControlPlaneData(
      [repository()],
      dependencies({
        observeGit: (async () => {
          throw new GitObservationError("/repos/example is not a git work tree");
        }) as unknown as ControlPlaneDependencies["observeGit"],
      }),
    );

    expect(data.positions).toEqual([]);
    expect(data.problems[0].reason).toContain("not a git work tree");
  });

  it("refuses to read a checkout that belongs to another host", async () => {
    const observeGit = vi.fn();
    const data = await buildControlPlaneData(
      [repository({ host: "vps-2" })],
      dependencies({ observeGit: observeGit as unknown as ControlPlaneDependencies["observeGit"] }),
    );

    expect(observeGit).not.toHaveBeenCalled();
    expect(data.problems[0].reason).toContain("vps-2");
  });

  it("does not let one failing container blank out the rest of the rail", async () => {
    const data = await buildControlPlaneData(
      [repository({ deployTargets: [{ environment: "production", containerName: "app-1" }] })],
      dependencies({
        observeRuntimeTarget: (async () => {
          throw new Error("docker daemon unreachable");
        }) as unknown as ControlPlaneDependencies["observeRuntimeTarget"],
      }),
    );

    expect(data.positions).toHaveLength(1);
    expect(data.positions[0].stages.find((stage) => stage.id === "committed")?.state).toBe("reached");
  });

  it("observes several repositories without serialising them", async () => {
    const repositories = Array.from({ length: 8 }, (_, index) => repository({ id: `repo-${index}`, name: `Repo ${index}` }));

    const data = await buildControlPlaneData(repositories, dependencies());

    expect(data.positions).toHaveLength(8);
    // Order is preserved despite the bounded worker pool.
    expect(data.positions.map((position) => position.name)).toEqual(repositories.map((entry) => entry.name));
  });
});
