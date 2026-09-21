import { countCommitsBetween, isAncestor } from "./git";
import {
  isObserved,
  STAGE_IDS,
  type Drift,
  type Evidence,
  type GitObservation,
  type RevisionPosition,
  type RuntimeObservation,
  type Stage,
  type StageId,
} from "./types";

/**
 * How old the remote-tracking refs may be before a comparison against them is
 * labelled stale. The control plane never fetches, so this is the difference
 * between "production matches main" and "production matched main as it looked
 * last week". Six hours is arbitrary but visible: the age is always shown.
 */
const STALE_REFS_AFTER_MS = 6 * 60 * 60 * 1000;

function evidence(label: string, value: string, source: string, observedAt: string | null = null): Evidence {
  return { label, value, source, observedAt };
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "unknown");

/**
 * Ancestry rather than equality, everywhere. A commit that was squashed or
 * rebased onto the default branch has a different SHA there, and asking "are
 * these two SHAs equal?" would report it as never merged for the rest of time.
 */
async function reachedDefaultBranch(
  path: string,
  sha: string,
  defaultBranchSha: string | null,
): Promise<boolean | null> {
  if (!defaultBranchSha) return null;
  if (sha === defaultBranchSha) return true;
  return isAncestor(path, sha, defaultBranchSha);
}

async function buildDrift(git: GitObservation, runtime: RuntimeObservation): Promise<Drift> {
  const deployedSha = isObserved(runtime.runningSha) ? runtime.runningSha.value : null;
  const defaultBranchSha = isObserved(git.defaultBranchSha) ? git.defaultBranchSha.value : null;
  const asOf = git.remoteRefsFetchedAt;
  const stale = asOf ? Date.now() - new Date(asOf).getTime() > STALE_REFS_AFTER_MS : true;

  const base = {
    deployedSha,
    defaultBranchSha,
    defaultBranch: git.defaultBranch,
    defaultBranchAsOf: asOf,
    stale,
  };

  if (!deployedSha || !defaultBranchSha) {
    return {
      ...base,
      status: "unknown",
      commitsBehind: null,
      detail: !deployedSha
        ? "The running revision could not be established, so it cannot be compared with the default branch."
        : `No remote-tracking ref for ${git.defaultBranch} in this checkout.`,
    };
  }

  if (deployedSha === defaultBranchSha) {
    return { ...base, status: "match", commitsBehind: 0, detail: `Production is running ${git.defaultBranch}.` };
  }

  const [deployedIsAncestor, defaultIsAncestor] = await Promise.all([
    isAncestor(git.path, deployedSha, defaultBranchSha),
    isAncestor(git.path, defaultBranchSha, deployedSha),
  ]);

  if (deployedIsAncestor === null || defaultIsAncestor === null) {
    return {
      ...base,
      status: "unknown",
      commitsBehind: null,
      // Usually the deployed commit was built from a branch this checkout has
      // never fetched — absence of the object is not evidence of divergence.
      detail: `This checkout does not contain ${short(deployedSha)}, so it cannot be placed relative to ${git.defaultBranch}.`,
    };
  }

  if (deployedIsAncestor) {
    const commitsBehind = await countCommitsBetween(git.path, deployedSha, defaultBranchSha);
    return {
      ...base,
      status: "behind",
      commitsBehind,
      detail: `Production is ${commitsBehind ?? "an unknown number of"} commit${commitsBehind === 1 ? "" : "s"} behind ${git.defaultBranch}.`,
    };
  }

  if (defaultIsAncestor) {
    return {
      ...base,
      status: "ahead",
      commitsBehind: 0,
      // Not a curiosity: it means something reached production without going
      // through the default branch.
      detail: `Production is running ${short(deployedSha)}, which is not on ${git.defaultBranch}.`,
    };
  }

  return {
    ...base,
    status: "diverged",
    commitsBehind: null,
    detail: `Production (${short(deployedSha)}) and ${git.defaultBranch} (${short(defaultBranchSha)}) have diverged.`,
  };
}

/**
 * Place one revision on the rail.
 *
 * Each stage answers for the commit in hand, not for the repository in general.
 * "Deployed" is not "something is deployed" — it is "this commit is what is
 * deployed", which is why a stage can be `diverged` while still holding a
 * perfectly healthy revision.
 */
export async function resolveRevisionPosition(
  git: GitObservation,
  runtime: RuntimeObservation,
  options: { repositoryId?: string | null; name?: string } = {},
): Promise<RevisionPosition> {
  const head = git.head;
  const defaultBranchSha = isObserved(git.defaultBranchSha) ? git.defaultBranchSha.value : null;
  const deployedSha = isObserved(runtime.runningSha) ? runtime.runningSha.value : null;

  const stages: Stage[] = [];

  // WORKING — uncommitted work is the one stage that is about the checkout
  // rather than the commit.
  const tree = git.workingTree;
  stages.push({
    id: "working",
    state: tree.clean ? "not_reached" : "reached",
    sha: null,
    detail: tree.clean
      ? "No uncommitted changes."
      : `${tree.changedFileCount} uncommitted change${tree.changedFileCount === 1 ? "" : "s"}` +
        `${tree.staged.length ? `, ${tree.staged.length} staged` : ""}` +
        `${tree.untracked.length ? `, ${tree.untracked.length} untracked` : ""}.`,
    evidence: [
      evidence("Modified", tree.modified.join(", ") || "none", "git status", git.observedAt),
      evidence("Staged", tree.staged.join(", ") || "none", "git status", git.observedAt),
      evidence("Untracked", tree.untracked.join(", ") || "none", "git status", git.observedAt),
    ],
  });

  // COMMITTED — a HEAD commit exists, so this is always reached; the value is
  // in the evidence, not the state.
  stages.push({
    id: "committed",
    state: "reached",
    sha: head.sha,
    detail: `${head.shortSha} — ${head.subject}`,
    evidence: [
      evidence("Commit", head.sha, "git log", git.observedAt),
      evidence("Author", head.author, "git log", git.observedAt),
      evidence("Committed", head.committedAt, "git log", git.observedAt),
      evidence("Branch", git.branch ?? "detached HEAD", "git rev-parse", git.observedAt),
    ],
  });

  // PUSHED
  if (!isObserved(git.upstream)) {
    stages.push({
      id: "pushed",
      state: "unknown",
      sha: null,
      detail: git.upstream.detail ?? "This branch tracks no remote branch.",
      evidence: [evidence("Upstream", "none", "git rev-parse @{upstream}", git.observedAt)],
    });
  } else {
    const upstream = git.upstream.value;
    const fetchedNote = git.remoteRefsFetchedAt
      ? `as of last fetch ${git.remoteRefsFetchedAt}`
      : "this checkout has never fetched";
    stages.push({
      id: "pushed",
      state: upstream.ahead === 0 ? "reached" : "not_reached",
      sha: upstream.remoteSha,
      detail:
        upstream.ahead === 0
          ? `Pushed to ${upstream.ref} (${fetchedNote}).`
          : `${upstream.ahead} commit${upstream.ahead === 1 ? "" : "s"} not pushed to ${upstream.ref}.`,
      evidence: [
        evidence("Upstream", upstream.ref, "git", git.observedAt),
        evidence("Ahead / behind", `${upstream.ahead} / ${upstream.behind}`, "git rev-list", git.observedAt),
        evidence("Remote ref last fetched", git.remoteRefsFetchedAt ?? "never", "FETCH_HEAD mtime", git.observedAt),
      ],
    });
  }

  // PR — deliberately never guessed. There is no forge credential, and
  // inferring a pull request from branch naming would be a fabrication.
  stages.push({
    id: "pr",
    state: "not_connected",
    sha: null,
    detail: "No forge integration is configured, so pull request state is unknown.",
    missingIntegration: "GitHub API",
    evidence: [],
  });

  // MERGED
  const merged = await reachedDefaultBranch(git.path, head.sha, defaultBranchSha);
  stages.push({
    id: "merged",
    state: merged === null ? "unknown" : merged ? "reached" : "not_reached",
    sha: defaultBranchSha,
    detail:
      merged === null
        ? `No remote-tracking ref for ${git.defaultBranch} in this checkout.`
        : merged
          ? `Contained in ${git.defaultBranch} (${short(defaultBranchSha)}).`
          : `Not yet in ${git.defaultBranch} (${short(defaultBranchSha)}).`,
    evidence: [
      evidence(`${git.defaultBranch} head`, defaultBranchSha ?? "unknown", `git (${git.defaultBranchSource})`, git.observedAt),
      evidence("Test", `git merge-base --is-ancestor ${short(head.sha)} ${short(defaultBranchSha)}`, "git", git.observedAt),
      evidence("Ref freshness", git.remoteRefsFetchedAt ?? "never fetched", "FETCH_HEAD mtime", git.observedAt),
    ],
  });

  // BUILT — an artifact exists that identifies a revision. Sentinel sees the
  // artifact, not the build, so this reports the artifact it can see; CI build
  // history is a separate integration that does not exist yet.
  const container = runtime.container;
  const builtThisRevision = deployedSha !== null && deployedSha === head.sha;
  stages.push({
    id: "built",
    state: container === null ? "unknown" : builtThisRevision ? "reached" : deployedSha ? "diverged" : "unknown",
    sha: deployedSha,
    detail:
      container === null
        ? "No container was found for this environment."
        : deployedSha
          ? `Image built from ${short(deployedSha)}${container.builtAt ? ` at ${container.builtAt}` : ""}.`
          : "The image declares no revision, so what it was built from is unknown.",
    evidence: container
      ? [
          evidence("Image", container.image, "docker inspect", container.observedAt),
          evidence("Image digest", container.imageDigest ?? "unknown", "docker inspect", container.observedAt),
          evidence("Revision source", container.shaSource, "docker inspect", container.observedAt),
          evidence("Built at", container.builtAt ?? "unknown", "container environment", container.observedAt),
        ]
      : [],
  });

  // DEPLOYED — about this commit specifically. A healthy container running a
  // different revision is `diverged`, not `reached`.
  stages.push({
    id: "deployed",
    state:
      container === null
        ? "not_reached"
        : container.state !== "running"
          ? "blocked"
          : !deployedSha
            ? "unknown"
            : deployedSha === head.sha
              ? "reached"
              : "diverged",
    sha: deployedSha,
    detail:
      container === null
        ? `No container is running for ${runtime.environment}.`
        : container.state !== "running"
          ? `Container ${container.name} is ${container.state}.`
          : deployedSha === head.sha
            ? `This commit is running in ${runtime.environment}.`
            : `${runtime.environment} is running ${short(deployedSha)}, not this commit.`,
    evidence: container
      ? [
          evidence("Container", container.name, "docker inspect", container.observedAt),
          evidence("State", container.state, "docker inspect", container.observedAt),
          evidence("Started", container.startedAt ?? "unknown", "docker inspect", container.observedAt),
          evidence("Restarts", String(container.restartCount), "docker inspect", container.observedAt),
          evidence("Source agreement", runtime.agreement, "control plane", runtime.observedAt),
        ]
      : [],
  });

  // VERIFIED — an external check actually answered. Docker's own healthcheck
  // counts, but is weaker than an endpoint probe: it proves the process is up,
  // not that the application serves.
  const healthObserved = isObserved(runtime.health) ? runtime.health.value : null;
  const dockerHealth = container?.health ?? "none";
  stages.push({
    id: "verified",
    state: healthObserved
      ? healthObserved.status === "ok"
        ? "reached"
        : "blocked"
      : dockerHealth === "healthy"
        ? "reached"
        : dockerHealth === "unhealthy"
          ? "blocked"
          : "not_connected",
    sha: deployedSha,
    detail: healthObserved
      ? `${healthObserved.url} → ${healthObserved.status}${healthObserved.httpStatus ? ` (${healthObserved.httpStatus})` : ""}.`
      : dockerHealth !== "none"
        ? `Container healthcheck reports ${dockerHealth}. No application health endpoint is configured.`
        : "No health endpoint is configured and the image defines no healthcheck.",
    missingIntegration: healthObserved || dockerHealth !== "none" ? undefined : "health endpoint",
    evidence: healthObserved
      ? [
          evidence("Endpoint", healthObserved.url, "health probe", healthObserved.checkedAt),
          evidence("Status", `${healthObserved.status} ${healthObserved.httpStatus ?? ""}`.trim(), "health probe", healthObserved.checkedAt),
          evidence("Latency", healthObserved.latencyMs === null ? "unknown" : `${healthObserved.latencyMs} ms`, "health probe", healthObserved.checkedAt),
        ]
      : container
        ? [evidence("Container healthcheck", dockerHealth, "docker inspect", container.observedAt)]
        : [],
  });

  return {
    repositoryId: options.repositoryId ?? null,
    name: options.name ?? git.path.split("/").filter(Boolean).at(-1) ?? git.path,
    path: git.path,
    branch: git.branch,
    head,
    stages,
    position: furthestReached(stages),
    drift: await buildDrift(git, runtime),
    environment: runtime.environment,
    observedAt: new Date().toISOString(),
  };
}

/**
 * The marker's position: the furthest stage actually reached, scanning forward
 * and stopping at the first gap.
 *
 * Stopping matters. A later stage can be `reached` for a different revision —
 * production is deployed and verified while this commit sits unpushed — and
 * taking the furthest `reached` stage anywhere on the rail would place the
 * marker at the end and report an unpushed change as live.
 */
function furthestReached(stages: Stage[]): StageId {
  let furthest: StageId = "committed";
  for (const id of STAGE_IDS) {
    if (id === "working") continue;
    const stage = stages.find((candidate) => candidate.id === id);
    if (!stage) break;
    if (stage.state === "reached") furthest = id;
    else if (stage.state === "not_connected" || stage.state === "unknown") continue;
    else break;
  }
  return furthest;
}
