import { WorkspaceError } from "../errors";
import { RemoteWorkspaceProvider, runnerClient } from "../runner/client";
import type { RuntimeProviderId, WorkspaceRuntimeProvider } from "../types";
import { DockerWorkspaceProvider } from "./docker";

let registry: Map<RuntimeProviderId, WorkspaceRuntimeProvider> | null = null;

/**
 * The Docker backend is reached through the workspace runner, the only process
 * holding the Docker socket (docs/SECURITY_REMEDIATION.md §3). Outside
 * production, with WORKSPACE_RUNNER_URL unset, it is reached directly. In
 * production an unset URL throws (runnerClient) instead of falling back.
 * Same interface either way.
 */
function buildRegistry() {
  const client = runnerClient();
  return new Map<RuntimeProviderId, WorkspaceRuntimeProvider>([
    ["docker", client ? new RemoteWorkspaceProvider(client) : new DockerWorkspaceProvider()],
  ]);
}

/**
 * The only place the app learns which backend it is talking to. Kubernetes,
 * Firecracker or a remote VPS backend registers here and nothing else changes.
 */
export function getRuntimeProvider(runtimeType: string): WorkspaceRuntimeProvider {
  registry ??= buildRegistry();
  const provider = registry.get(runtimeType as RuntimeProviderId);
  if (!provider) {
    throw new WorkspaceError(`No runtime provider is registered for "${runtimeType}".`, "runtime_unavailable");
  }
  return provider;
}

export function listRuntimeProviders() {
  registry ??= buildRegistry();
  return [...registry.keys()];
}

export function resetRuntimeProvidersForTests() {
  registry = null;
}
