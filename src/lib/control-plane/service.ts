import { db } from "@/lib/db";
import { GitObservationError, observeRepository } from "./git";
import { observeRuntime, type RuntimeTarget } from "./runtime";
import { resolveRevisionPosition } from "./position";
import { unobserved, type RevisionPosition, type RuntimeObservation } from "./types";

/**
 * Observing a repository costs several git invocations and a container
 * inspection. Running every repository at once would turn a page load into a
 * burst of subprocesses; running them one at a time makes the slowest
 * repository the page's latency. Four at a time is the compromise.
 */
const CONCURRENCY = 4;

export interface RepositoryProblem {
  repositoryId: string;
  name: string;
  path: string | null;
  reason: string;
}

export interface ControlPlaneData {
  positions: RevisionPosition[];
  /**
   * Repositories that are registered but could not be observed. Surfaced
   * rather than filtered out: a repository silently missing from the rail
   * looks like a repository with nothing happening.
   */
  problems: RepositoryProblem[];
  generatedAt: string;
}

interface DeployTarget {
  environment?: unknown;
  containerName?: unknown;
  versionUrl?: unknown;
  healthUrl?: unknown;
}

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Deploy targets come from a JSON column, so they are parsed defensively — a
 * malformed row must degrade to "not configured" rather than throw and take the
 * whole control plane down with it.
 */
export function parseDeployTargets(value: unknown): RuntimeTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const target = entry as DeployTarget;
    const environment = asString(target.environment);
    if (!environment) return [];
    return [
      {
        environment,
        containerName: asString(target.containerName),
        versionUrl: asString(target.versionUrl),
        healthUrl: asString(target.healthUrl),
      },
    ];
  });
}

/** A repository with no configured target still gets a rail; its later stages are unconfigured. */
function unconfiguredRuntime(environment: string): RuntimeObservation {
  return {
    environment,
    container: null,
    version: unobserved("not_configured", "version endpoint", "No deployment target is configured for this repository."),
    health: unobserved("not_configured", "health endpoint", "No deployment target is configured for this repository."),
    runningSha: unobserved("not_configured", "deployment target", "No deployment target is configured for this repository."),
    agreement: "none",
    observedAt: new Date().toISOString(),
  };
}

async function mapWithLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ControlPlaneDependencies {
  observeGit: typeof observeRepository;
  observeRuntimeTarget: typeof observeRuntime;
}

const defaultDependencies: ControlPlaneDependencies = {
  observeGit: observeRepository,
  observeRuntimeTarget: observeRuntime,
};

export interface RegisteredRepository {
  id: string;
  name: string;
  localPath: string | null;
  host: string;
  deployTargets: unknown;
}

/**
 * Place every registered repository on the rail.
 *
 * Only repositories on this host are observed. A repository recorded as living
 * on another machine is reported as a problem naming that host, because reading
 * the local filesystem for it would silently answer with the wrong checkout —
 * or with nothing, which reads as "clean".
 */
export async function buildControlPlaneData(
  repositories: RegisteredRepository[],
  dependencies: ControlPlaneDependencies = defaultDependencies,
  host = process.env.SENTINEL_HOST_ID ?? "local",
): Promise<ControlPlaneData> {
  const problems: RepositoryProblem[] = [];

  const positions = await mapWithLimit(repositories, CONCURRENCY, async (repository) => {
    if (repository.host !== host) {
      problems.push({
        repositoryId: repository.id,
        name: repository.name,
        path: repository.localPath,
        reason: `Registered on host "${repository.host}", which this Sentinel instance cannot read.`,
      });
      return null;
    }

    if (!repository.localPath) {
      problems.push({
        repositoryId: repository.id,
        name: repository.name,
        path: null,
        reason: "No local checkout is recorded, so its working state cannot be observed.",
      });
      return null;
    }

    let git;
    try {
      git = await dependencies.observeGit(repository.localPath);
    } catch (error) {
      problems.push({
        repositoryId: repository.id,
        name: repository.name,
        path: repository.localPath,
        reason:
          error instanceof GitObservationError
            ? error.message
            : `Could not read ${repository.localPath}: ${error instanceof Error ? error.message : "unknown error"}.`,
      });
      return null;
    }

    const targets = parseDeployTargets(repository.deployTargets);
    // One rail per environment. A repository deployed nowhere still gets one,
    // so the first half of its rail — the half that is entirely knowable from
    // the checkout — is not withheld because the second half is unconfigured.
    const runtimes = targets.length
      ? await Promise.all(targets.map((target) => dependencies.observeRuntimeTarget(target).catch(() => unconfiguredRuntime(target.environment))))
      : [unconfiguredRuntime("production")];

    return Promise.all(
      runtimes.map((runtime) =>
        resolveRevisionPosition(git, runtime, { repositoryId: repository.id, name: repository.name }),
      ),
    );
  });

  return {
    positions: positions.flatMap((entry) => entry ?? []),
    problems,
    generatedAt: new Date().toISOString(),
  };
}

/** Load the registered repositories and observe them. */
export async function loadControlPlane(dependencies?: ControlPlaneDependencies): Promise<ControlPlaneData> {
  const repositories = await db.repository.findMany({
    select: { id: true, name: true, localPath: true, host: true, deployTargets: true },
    orderBy: { name: "asc" },
  });
  return buildControlPlaneData(repositories, dependencies);
}
