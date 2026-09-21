/**
 * The control plane's one claim: where is this change right now?
 *
 * Every field an operator acts on carries where it came from and when it was
 * seen. A value with no provenance is not rendered as fact — the UI shows
 * `unknown` or `not_connected` instead, and says which integration is missing.
 * That is why `Observed<T>` wraps values rather than the code returning bare
 * strings: an unobserved SHA and an observed one must not be the same type.
 */

/** Why a stage cannot be answered, as opposed to answering it badly. */
export type UnknownReason =
  | "not_connected"
  | "not_configured"
  | "no_repository"
  | "no_upstream"
  | "command_failed"
  | "not_observed";

export interface Observed<T> {
  value: T;
  /** git | docker | version_endpoint | health_probe | github_api | database */
  source: string;
  observedAt: string;
}

export interface Unobserved {
  value: null;
  reason: UnknownReason;
  /** Named so the UI can tell the operator what to connect, not just that it is missing. */
  missingIntegration?: string;
  detail?: string;
}

export type Maybe<T> = Observed<T> | Unobserved;

export const observed = <T>(value: T, source: string, observedAt = new Date().toISOString()): Observed<T> => ({
  value,
  source,
  observedAt,
});

export const unobserved = (reason: UnknownReason, missingIntegration?: string, detail?: string): Unobserved => ({
  value: null,
  reason,
  ...(missingIntegration ? { missingIntegration } : {}),
  ...(detail ? { detail } : {}),
});

export const isObserved = <T>(value: Maybe<T>): value is Observed<T> => value.value !== null;

// --- Git observation ---

export interface CommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  committedAt: string;
}

export interface WorkingTree {
  /** Tracked files with unstaged changes. */
  modified: string[];
  /** Changes added to the index but not committed. */
  staged: string[];
  untracked: string[];
  /** Total across all three, since the lists are capped for transport. */
  changedFileCount: number;
  /** True when the lists were truncated, so "4 files" is never a lie. */
  truncated: boolean;
  clean: boolean;
}

export interface UpstreamState {
  ref: string;
  ahead: number;
  behind: number;
  /** Remote-tracking SHA — as of the last fetch, not as of now. */
  remoteSha: string | null;
}

/**
 * How `defaultBranch` was established. `origin_head` is local clone metadata
 * that is never refreshed, so it is weaker evidence than a remote-tracking ref
 * that actually exists, and `assumed` is not evidence at all.
 */
export type DefaultBranchSource = "remote_ref" | "origin_head" | "assumed";

export interface GitObservation {
  path: string;
  /** Null when HEAD is detached, which is a state worth showing, not hiding. */
  branch: string | null;
  detached: boolean;
  head: CommitSummary;
  workingTree: WorkingTree;
  upstream: Maybe<UpstreamState>;
  remoteUrl: string | null;
  /** SHA of the default branch's remote-tracking ref, as of the last fetch. */
  defaultBranchSha: Maybe<string>;
  defaultBranch: string;
  defaultBranchSource: DefaultBranchSource;
  /**
   * When this checkout last talked to its remote. Everything in `upstream` and
   * `defaultBranchSha` is only as current as this — the control plane never
   * fetches on a read, so a stale clone must announce itself rather than
   * quietly reporting "0 behind".
   */
  remoteRefsFetchedAt: string | null;
  observedAt: string;
}

// --- Runtime observation ---

/**
 * What is actually running, as opposed to what was deployed.
 *
 * `sha` is separated from `shaSource` on purpose. A container can report its
 * revision through an OCI label (written by the build, hard to fake), through
 * a baked environment variable (written by the deploy, easy to leave stale),
 * or not at all. Those are not equally strong claims and the interface must
 * not present them as one.
 */
export type ShaSource = "oci_label" | "env_release_sha" | "env_commit" | "version_endpoint" | "none";

export interface ContainerObservation {
  name: string;
  /** running | exited | restarting | paused | dead | created */
  state: string;
  /** Docker's own healthcheck verdict, when the image defines one. */
  health: "healthy" | "unhealthy" | "starting" | "none";
  image: string;
  /** Immutable artifact identity. A tag can be reused; this cannot. */
  imageDigest: string | null;
  startedAt: string | null;
  restartCount: number;
  sha: Maybe<string>;
  shaSource: ShaSource;
  builtAt: string | null;
  /** compose project/service, when the container was started by compose. */
  composeProject: string | null;
  composeService: string | null;
  observedAt: string;
}

export interface VersionEndpointObservation {
  url: string;
  commit: string | null;
  builtAt: string | null;
  environment: string | null;
  observedAt: string;
}

export interface HealthProbeObservation {
  url: string;
  /** ok | degraded | down | unreachable */
  status: string;
  httpStatus: number | null;
  latencyMs: number | null;
  detail: string | null;
  checkedAt: string;
}

/**
 * One environment, assembled from every independent source that had something
 * to say about it.
 *
 * `agreement` exists because two sources reporting the same SHA is materially
 * stronger evidence than one source reporting it, and two sources disagreeing
 * is the single most important thing the control plane can tell an operator —
 * it means the container was replaced without its metadata being updated, or
 * the endpoint is serving a constant baked at an earlier build.
 */
export type SourceAgreement = "corroborated" | "single_source" | "conflicting" | "none";

export interface RuntimeObservation {
  environment: string;
  container: ContainerObservation | null;
  version: Maybe<VersionEndpointObservation>;
  health: Maybe<HealthProbeObservation>;
  /** The SHA the control plane is prepared to claim is running, if any. */
  runningSha: Maybe<string>;
  agreement: SourceAgreement;
  observedAt: string;
}

// --- Revision position ---

/**
 * The eight places a change can be. Ordered, because the rail draws them in
 * this order and because "furthest reached" is only meaningful on an order.
 */
export const STAGE_IDS = [
  "working",
  "committed",
  "pushed",
  "pr",
  "merged",
  "built",
  "deployed",
  "verified",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

/**
 * `reached` and `not_reached` are claims about the revision in hand.
 * `unknown` means the question was asked and could not be answered.
 * `not_connected` means it was never asked because the integration is absent —
 * kept distinct so the interface can name what to connect instead of implying
 * something is wrong with the code.
 * `blocked` is a stage that actively failed, which is different from one that
 * has simply not happened yet.
 * `diverged` is a stage holding a revision other than the one in hand — the
 * case that matters most: production running something that is not this change.
 */
export type StageState = "reached" | "not_reached" | "blocked" | "diverged" | "unknown" | "not_connected";

export interface Evidence {
  label: string;
  value: string;
  source: string;
  observedAt: string | null;
}

export interface Stage {
  id: StageId;
  state: StageState;
  /** The revision this stage holds, when it holds one and it is known. */
  sha: string | null;
  /** One line an operator can act on. Never decorative. */
  detail: string;
  evidence: Evidence[];
  missingIntegration?: string;
}

/** Production against the default branch: the question the rail exists to answer. */
export type DriftStatus = "match" | "behind" | "ahead" | "diverged" | "unknown";

export interface Drift {
  status: DriftStatus;
  deployedSha: string | null;
  defaultBranchSha: string | null;
  defaultBranch: string;
  /** Commits on the default branch that are not deployed. */
  commitsBehind: number | null;
  /**
   * When the default branch ref was last refreshed from the remote. Everything
   * compared against it is only as current as this.
   */
  defaultBranchAsOf: string | null;
  /** True when that ref is old enough that the comparison should not be trusted. */
  stale: boolean;
  detail: string;
}

export interface RevisionPosition {
  repositoryId: string | null;
  name: string;
  path: string;
  branch: string | null;
  head: CommitSummary;
  stages: Stage[];
  /** Furthest stage this revision has actually reached. */
  position: StageId;
  drift: Drift;
  environment: string;
  observedAt: string;
}
