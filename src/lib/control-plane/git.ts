import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  observed,
  unobserved,
  type CommitSummary,
  type DefaultBranchSource,
  type GitObservation,
  type Maybe,
  type UpstreamState,
  type WorkingTree,
} from "./types";

const run = promisify(execFile);

/**
 * Longest a single git command may take before the whole observation is
 * abandoned. A repository on slow storage delaying the dashboard is a bug; a
 * dashboard that hangs on it is a worse one.
 */
const GIT_TIMEOUT_MS = 5_000;

/** Per-category cap on the file lists. The counts stay exact; the lists do not. */
const MAX_LISTED_FILES = 25;

export class GitObservationError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "GitObservationError";
  }
}

/**
 * Every git call goes through here. `execFile` with an argv array means no
 * shell is involved, so a branch named `; rm -rf /` is an argument and nothing
 * else — the control plane reads repositories it did not create and must not
 * assume their refs are well-behaved.
 *
 * Read-only by construction: `fetch`, `pull` and anything else that mutates or
 * touches the network is rejected here rather than trusted not to be called.
 * A dashboard render must never change the state it is reporting on.
 */
const READ_ONLY_COMMANDS = new Set([
  "rev-parse", "log", "status", "rev-list", "config", "symbolic-ref", "for-each-ref", "show-ref",
]);

async function git(repoPath: string, args: string[]): Promise<string> {
  const command = args[0];
  if (!READ_ONLY_COMMANDS.has(command)) {
    throw new GitObservationError(`Refusing to run a non-read-only git command: ${command}`);
  }
  try {
    const { stdout } = await run("git", ["-C", repoPath, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      // A repository's own hooks and config must not be able to influence an
      // observation, and no command here needs a pager or a terminal.
      env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GitObservationError(`git ${command} failed in ${repoPath}`, detail);
  }
}

/** Porcelain v1 codes: XY path, with `??` for untracked and `R  old -> new`. */
function parseStatus(stdout: string): WorkingTree {
  const modified: string[] = [];
  const staged: string[] = [];
  const untracked: string[] = [];
  let changedFileCount = 0;

  for (const line of stdout.split("\0")) {
    if (!line) continue;
    const code = line.slice(0, 2);
    // A rename records both paths; the one that matters to an operator is where
    // the file is now.
    const file = line.slice(3).split(" -> ").at(-1) ?? "";
    if (!file) continue;
    changedFileCount += 1;

    if (code === "??") untracked.push(file);
    else {
      // Index and worktree columns are independent: `MM` is a file that is both
      // staged and modified again since, and belongs in both lists.
      if (code[0] !== " " && code[0] !== "?") staged.push(file);
      if (code[1] !== " " && code[1] !== "?") modified.push(file);
    }
  }

  const truncated =
    modified.length > MAX_LISTED_FILES || staged.length > MAX_LISTED_FILES || untracked.length > MAX_LISTED_FILES;

  return {
    modified: modified.slice(0, MAX_LISTED_FILES),
    staged: staged.slice(0, MAX_LISTED_FILES),
    untracked: untracked.slice(0, MAX_LISTED_FILES),
    changedFileCount,
    truncated,
    clean: changedFileCount === 0,
  };
}

function parseHead(stdout: string): CommitSummary {
  // Unit separator, because a commit subject can contain anything a tab or pipe
  // could contain.
  const [sha, shortSha, subject, author, committedAt] = stdout.trim().split("\u001f");
  if (!sha) throw new GitObservationError("HEAD commit could not be read");
  return { sha, shortSha, subject, author, committedAt };
}

async function readUpstream(repoPath: string): Promise<Maybe<UpstreamState>> {
  let ref: string;
  try {
    ref = (await git(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim();
  } catch {
    // No upstream is an ordinary state for a local-only branch, not a failure.
    return unobserved("no_upstream", undefined, "This branch does not track a remote branch.");
  }

  const counts = (await git(repoPath, ["rev-list", "--left-right", "--count", `${ref}...HEAD`])).trim().split(/\s+/);
  const remoteSha = await git(repoPath, ["rev-parse", ref]).then((value) => value.trim()).catch(() => null);

  return observed(
    { ref, behind: Number(counts[0]) || 0, ahead: Number(counts[1]) || 0, remoteSha },
    "git",
  );
}

/**
 * The default branch this checkout believes its remote has.
 *
 * `refs/remotes/origin/HEAD` is the obvious source and the wrong first choice:
 * it is local metadata written at clone time and never updated, so a checkout
 * that once had its HEAD repointed keeps claiming a long-dead feature branch is
 * the default. That was not hypothetical — Sentinel's own clone claimed exactly
 * that, which would have had every project permanently reported as "not
 * merged" against a branch nobody uses.
 *
 * So the ordinary names are checked first, `origin/HEAD` is the fallback for
 * repositories that genuinely default to something else, and the result says
 * which of the two answered. The authoritative answer is the forge's API, and
 * when that integration exists it should override this entirely.
 */
async function readDefaultBranch(
  repoPath: string,
): Promise<{ name: string; sha: Maybe<string>; source: DefaultBranchSource }> {
  let name: string | null = null;
  let source: DefaultBranchSource = "assumed";

  for (const candidate of ["main", "master"]) {
    try {
      await git(repoPath, ["rev-parse", "--verify", `refs/remotes/origin/${candidate}`]);
      name = candidate;
      source = "remote_ref";
      break;
    } catch {
      // Absence is not an error; try the next candidate.
    }
  }

  if (!name) {
    try {
      const symbolic = (await git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
      if (symbolic) {
        name = symbolic.replace(/^origin\//, "");
        source = "origin_head";
      }
    } catch {
      // No origin/HEAD either.
    }
  }

  if (!name) {
    return {
      name: "main",
      source: "assumed",
      sha: unobserved("not_observed", undefined, "This checkout has no remote-tracking branches."),
    };
  }

  try {
    const sha = (await git(repoPath, ["rev-parse", `refs/remotes/origin/${name}`])).trim();
    return { name, source, sha: observed(sha, "git") };
  } catch {
    return {
      name,
      source,
      sha: unobserved("not_observed", undefined, `No remote-tracking ref for origin/${name} in this checkout.`),
    };
  }
}

/**
 * When this checkout last heard from its remote. Read from FETCH_HEAD's mtime
 * because git records no other timestamp for it. Without this the ahead/behind
 * numbers would be presented as current when they can be weeks old — the
 * control plane deliberately never fetches, so it must say how stale it is.
 */
async function readFetchTime(repoPath: string): Promise<string | null> {
  try {
    const gitDir = (await git(repoPath, ["rev-parse", "--git-dir"])).trim();
    const absolute = path.isAbsolute(gitDir) ? gitDir : path.join(repoPath, gitDir);
    const info = await stat(path.join(absolute, "FETCH_HEAD"));
    return info.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Observe one checkout. Read-only, no network, no mutation of the repository.
 *
 * Throws `GitObservationError` when the path is not a repository at all; that
 * is a configuration error worth surfacing, distinct from the ordinary
 * unobservable states (no upstream, no remote ref) which are returned as data.
 */
export async function observeRepository(repoPath: string): Promise<GitObservation> {
  const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside.trim() !== "true") {
    throw new GitObservationError(`${repoPath} is not a git work tree`);
  }

  const [headRaw, statusRaw, branchRaw, remoteUrlRaw] = await Promise.all([
    git(repoPath, ["log", "-1", "--format=%H\u001f%h\u001f%s\u001f%an\u001f%cI"]),
    // -z terminates entries with NUL, so a filename containing a newline or a
    // quote cannot split one entry into two.
    git(repoPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(repoPath, ["config", "--get", "remote.origin.url"]).catch(() => ""),
  ]);

  const branchName = branchRaw.trim();
  const detached = branchName === "HEAD";

  const [upstream, defaultBranch, remoteRefsFetchedAt] = await Promise.all([
    detached
      ? Promise.resolve(unobserved("no_upstream", undefined, "HEAD is detached."))
      : readUpstream(repoPath),
    readDefaultBranch(repoPath),
    readFetchTime(repoPath),
  ]);

  return {
    path: repoPath,
    branch: detached ? null : branchName,
    detached,
    head: parseHead(headRaw),
    workingTree: parseStatus(statusRaw),
    upstream,
    remoteUrl: remoteUrlRaw.trim() || null,
    defaultBranch: defaultBranch.name,
    defaultBranchSource: defaultBranch.source,
    defaultBranchSha: defaultBranch.sha,
    remoteRefsFetchedAt,
    observedAt: new Date().toISOString(),
  };
}
