import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { GitObservationError, observeRepository } from "./git";
import { isObserved } from "./types";

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

/** A repository with one commit on `main` and no remote. */
async function newRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sentinel-git-"));
  created.push(dir);
  await git(dir, "init", "--initial-branch=main", "--quiet");
  await writeFile(path.join(dir, "README.md"), "initial\n");
  await git(dir, "add", "README.md");
  await git(dir, "commit", "--quiet", "-m", "initial commit");
  return dir;
}

afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("observeRepository", () => {
  it("reports a clean checkout as clean, with the commit an operator would act on", async () => {
    const repo = await newRepo();
    const observation = await observeRepository(repo);

    expect(observation.branch).toBe("main");
    expect(observation.detached).toBe(false);
    expect(observation.head.subject).toBe("initial commit");
    expect(observation.head.shortSha).toHaveLength(7);
    expect(observation.workingTree.clean).toBe(true);
    expect(observation.workingTree.changedFileCount).toBe(0);
  });

  it("separates staged, modified and untracked work instead of one dirty flag", async () => {
    const repo = await newRepo();
    await writeFile(path.join(repo, "staged.txt"), "staged\n");
    await git(repo, "add", "staged.txt");
    await writeFile(path.join(repo, "README.md"), "changed\n");
    await writeFile(path.join(repo, "untracked.txt"), "new\n");

    const { workingTree } = await observeRepository(repo);

    expect(workingTree.staged).toContain("staged.txt");
    expect(workingTree.modified).toContain("README.md");
    expect(workingTree.untracked).toContain("untracked.txt");
    expect(workingTree.changedFileCount).toBe(3);
    expect(workingTree.clean).toBe(false);
  });

  it("counts a file that is staged and then modified again in both lists", async () => {
    const repo = await newRepo();
    await writeFile(path.join(repo, "both.txt"), "one\n");
    await git(repo, "add", "both.txt");
    await writeFile(path.join(repo, "both.txt"), "two\n");

    const { workingTree } = await observeRepository(repo);

    expect(workingTree.staged).toContain("both.txt");
    expect(workingTree.modified).toContain("both.txt");
    // One file changed, listed twice because two different things are true of it.
    expect(workingTree.changedFileCount).toBe(1);
  });

  it("does not split a filename containing a newline into two entries", async () => {
    const repo = await newRepo();
    await writeFile(path.join(repo, "line\nbreak.txt"), "x\n");

    const { workingTree } = await observeRepository(repo);

    expect(workingTree.untracked).toEqual(["line\nbreak.txt"]);
    expect(workingTree.changedFileCount).toBe(1);
  });

  it("treats a branch with no upstream as unobservable rather than up to date", async () => {
    const repo = await newRepo();
    const { upstream } = await observeRepository(repo);

    expect(isObserved(upstream)).toBe(false);
    expect(upstream.value).toBeNull();
    if (!isObserved(upstream)) expect(upstream.reason).toBe("no_upstream");
  });

  it("measures ahead and behind against the tracking ref", async () => {
    const origin = await mkdtemp(path.join(tmpdir(), "sentinel-origin-"));
    created.push(origin);
    await run("git", ["init", "--bare", "--initial-branch=main", "--quiet", origin]);

    const repo = await newRepo();
    await git(repo, "remote", "add", "origin", origin);
    await git(repo, "push", "--quiet", "-u", "origin", "main");

    await writeFile(path.join(repo, "second.txt"), "second\n");
    await git(repo, "add", "second.txt");
    await git(repo, "commit", "--quiet", "-m", "second commit");

    const observation = await observeRepository(repo);

    expect(isObserved(observation.upstream)).toBe(true);
    if (isObserved(observation.upstream)) {
      expect(observation.upstream.value.ref).toBe("origin/main");
      expect(observation.upstream.value.ahead).toBe(1);
      expect(observation.upstream.value.behind).toBe(0);
    }
    expect(observation.remoteUrl).toBe(origin);
    // The local commit is ahead, so it cannot be what origin/main points at.
    expect(observation.defaultBranchSha.value).not.toBe(observation.head.sha);
  });

  it("reports a detached HEAD as detached instead of inventing a branch name", async () => {
    const repo = await newRepo();
    await git(repo, "checkout", "--quiet", "--detach", "HEAD");

    const observation = await observeRepository(repo);

    expect(observation.detached).toBe(true);
    expect(observation.branch).toBeNull();
    expect(isObserved(observation.upstream)).toBe(false);
  });

  it("prefers a real remote-tracking branch over stale origin/HEAD metadata", async () => {
    const origin = await mkdtemp(path.join(tmpdir(), "sentinel-origin-head-"));
    created.push(origin);
    await run("git", ["init", "--bare", "--initial-branch=main", "--quiet", origin]);

    const repo = await newRepo();
    await git(repo, "remote", "add", "origin", origin);
    await git(repo, "push", "--quiet", "-u", "origin", "main");
    await git(repo, "push", "--quiet", "origin", "main:stale-feature");
    await git(repo, "fetch", "--quiet", "origin");
    // Exactly the state Sentinel's own clone was in: origin/HEAD left pointing
    // at a feature branch that is not the default.
    await git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/stale-feature");

    const observation = await observeRepository(repo);

    expect(observation.defaultBranch).toBe("main");
    expect(observation.defaultBranchSource).toBe("remote_ref");
  });

  it("fails loudly when the path is not a repository", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sentinel-plain-"));
    created.push(dir);

    await expect(observeRepository(dir)).rejects.toBeInstanceOf(GitObservationError);
  });

  it("never reports on a repository whose refs were fetched at an unknown time without saying so", async () => {
    const repo = await newRepo();
    const observation = await observeRepository(repo);

    // Nothing has fetched, so the field is null rather than "now".
    expect(observation.remoteRefsFetchedAt).toBeNull();
  });
});
