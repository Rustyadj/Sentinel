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
