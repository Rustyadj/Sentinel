import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { observeRepository } from "./git";
import { resolveRevisionPosition } from "./position";
import { observed, unobserved, type ContainerObservation, type RuntimeObservation, type StageId } from "./types";

const run = promisify(execFile);
const created: string[] = [];

async function git(cwd: string, ...args: string[]) {
  await run("git", ["-C", cwd, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

/** A clone with a real origin, so ancestry questions are answered by real git. */
async function repoWithOrigin(): Promise<string> {
  const origin = await mkdtemp(path.join(tmpdir(), "sentinel-pos-origin-"));
  const dir = await mkdtemp(path.join(tmpdir(), "sentinel-pos-"));
  created.push(origin, dir);
  await run("git", ["init", "--bare", "--initial-branch=main", "--quiet", origin]);
  await git(dir, "init", "--initial-branch=main", "--quiet");
  await writeFile(path.join(dir, "README.md"), "initial\n");
  await git(dir, "add", "README.md");
  await git(dir, "commit", "--quiet", "-m", "initial commit");
  await git(dir, "remote", "add", "origin", origin);
  await git(dir, "push", "--quiet", "-u", "origin", "main");
  await git(dir, "fetch", "--quiet", "origin");
  return dir;
}

async function commit(dir: string, name: string) {
  await writeFile(path.join(dir, name), `${name}\n`);
  await git(dir, "add", name);
  await git(dir, "commit", "--quiet", "-m", `add ${name}`);
}

function container(overrides: Partial<ContainerObservation> = {}): ContainerObservation {
  return {
    name: "app-1",
    state: "running",
    health: "healthy",
    image: "app:latest",
    imageDigest: "sha256:abc",
    startedAt: "2026-09-20T15:00:00Z",
    restartCount: 0,
    sha: observed("0".repeat(40), "docker:env_release_sha"),
    shaSource: "env_release_sha",
    builtAt: "2026-09-20T14:58:55Z",
    composeProject: "sentinel-os",
    composeService: "app",
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A runtime that is running `sha`, or nothing at all when sha is null. */
function runtime(sha: string | null, overrides: Partial<RuntimeObservation> = {}): RuntimeObservation {
  return {
    environment: "production",
    container: sha ? container({ sha: observed(sha, "docker:env_release_sha") }) : null,
    version: unobserved("not_configured", "version endpoint"),
    health: unobserved("not_configured", "health endpoint"),
    runningSha: sha ? observed(sha, "docker:env_release_sha") : unobserved("not_observed"),
    agreement: sha ? "single_source" : "none",
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

const stage = (position: Awaited<ReturnType<typeof resolveRevisionPosition>>, id: StageId) =>
  position.stages.find((candidate) => candidate.id === id)!;

afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveRevisionPosition", () => {
  it("places a commit that is pushed, merged, deployed and healthy at the end of the rail", async () => {
    const repo = await repoWithOrigin();
    const observation = await observeRepository(repo);

    const position = await resolveRevisionPosition(observation, runtime(observation.head.sha));

    expect(stage(position, "pushed").state).toBe("reached");
    expect(stage(position, "merged").state).toBe("reached");
    expect(stage(position, "deployed").state).toBe("reached");
    expect(stage(position, "verified").state).toBe("reached");
    expect(position.position).toBe("verified");
    expect(position.drift.status).toBe("match");
  });

  it("stops the marker at the first gap instead of jumping to a later stage held by another revision", async () => {
    const repo = await repoWithOrigin();
    const deployed = (await observeRepository(repo)).head.sha;
    await commit(repo, "local-only.txt");
    const observation = await observeRepository(repo);

    // Production is deployed and verified — but of the previous commit.
    const position = await resolveRevisionPosition(observation, runtime(deployed));

    expect(stage(position, "pushed").state).toBe("not_reached");
    expect(stage(position, "deployed").state).toBe("diverged");
    expect(position.position).toBe("committed");
  });

  it("counts how far production is behind the default branch", async () => {
    const repo = await repoWithOrigin();
    const deployed = (await observeRepository(repo)).head.sha;
    await commit(repo, "one.txt");
    await commit(repo, "two.txt");
    await git(repo, "push", "--quiet", "origin", "main");
    await git(repo, "fetch", "--quiet", "origin");
    const observation = await observeRepository(repo);

    const position = await resolveRevisionPosition(observation, runtime(deployed));

    expect(position.drift.status).toBe("behind");
    expect(position.drift.commitsBehind).toBe(2);
    expect(position.drift.detail).toContain("2 commits behind main");
  });

  it("reports production running something that is not on the default branch", async () => {
    const repo = await repoWithOrigin();
    await commit(repo, "unmerged.txt");
    const observation = await observeRepository(repo);

    // The deployed commit exists locally but was never pushed to main.
    const position = await resolveRevisionPosition(observation, runtime(observation.head.sha));

    expect(position.drift.status).toBe("ahead");
    expect(position.drift.detail).toContain("not on main");
  });

  it("treats a commit this checkout has never seen as unplaceable, not as divergence", async () => {
    const repo = await repoWithOrigin();
    const observation = await observeRepository(repo);

    const position = await resolveRevisionPosition(observation, runtime("f".repeat(40)));

    expect(position.drift.status).toBe("unknown");
    expect(position.drift.detail).toContain("does not contain");
  });

  it("recognises a squashed commit as merged, which SHA equality never would", async () => {
    const repo = await repoWithOrigin();
    await git(repo, "checkout", "--quiet", "-b", "feature");
    await commit(repo, "feature.txt");
    const featureSha = (await observeRepository(repo)).head.sha;

    await git(repo, "checkout", "--quiet", "main");
    await git(repo, "merge", "--quiet", "--no-ff", "-m", "merge feature", "feature");
    await git(repo, "push", "--quiet", "origin", "main");
    await git(repo, "fetch", "--quiet", "origin");
    await git(repo, "checkout", "--quiet", "feature");
    const observation = await observeRepository(repo);

    expect(observation.head.sha).toBe(featureSha);
    const position = await resolveRevisionPosition(observation, runtime(null));

    // The feature SHA is not main's head, but it is contained in main's history.
    expect(stage(position, "merged").state).toBe("reached");
  });

  it("never guesses pull request state, and names the integration that would answer", async () => {
    const repo = await repoWithOrigin();
    const position = await resolveRevisionPosition(await observeRepository(repo), runtime(null));

    const pr = stage(position, "pr");
    expect(pr.state).toBe("not_connected");
    expect(pr.missingIntegration).toBe("GitHub API");
    expect(pr.sha).toBeNull();
  });

  it("separates a stopped container from a missing one", async () => {
    const repo = await repoWithOrigin();
    const observation = await observeRepository(repo);

    const stopped = await resolveRevisionPosition(
      observation,
      runtime(observation.head.sha, { container: container({ state: "exited" }) }),
    );
    expect(stage(stopped, "deployed").state).toBe("blocked");
    expect(stage(stopped, "deployed").detail).toContain("exited");

    const absent = await resolveRevisionPosition(observation, runtime(null));
    expect(stage(absent, "deployed").state).toBe("not_reached");
  });

  it("does not report uncommitted work as clean, and lists what changed", async () => {
    const repo = await repoWithOrigin();
    await writeFile(path.join(repo, "dirty.txt"), "wip\n");
    const observation = await observeRepository(repo);

    const position = await resolveRevisionPosition(observation, runtime(null));
    const working = stage(position, "working");

    expect(working.state).toBe("reached");
    expect(working.detail).toContain("1 uncommitted change");
    expect(working.evidence.some((item) => item.value.includes("dirty.txt"))).toBe(true);
  });

  it("marks a comparison against refs that were never fetched as stale", async () => {
    const repo = await repoWithOrigin();
    const observation = await observeRepository(repo);

    const position = await resolveRevisionPosition(
      { ...observation, remoteRefsFetchedAt: null },
      runtime(observation.head.sha),
    );

    expect(position.drift.stale).toBe(true);
    expect(position.drift.defaultBranchAsOf).toBeNull();
  });

  it("falls back to the container healthcheck but says the endpoint is missing", async () => {
    const repo = await repoWithOrigin();
    const observation = await observeRepository(repo);

    const position = await resolveRevisionPosition(
      observation,
      runtime(observation.head.sha, { container: container({ health: "unhealthy" }) }),
    );

    const verified = stage(position, "verified");
    expect(verified.state).toBe("blocked");
    expect(verified.detail).toContain("No application health endpoint is configured");
  });
});
