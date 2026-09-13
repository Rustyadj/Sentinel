import { WorkspaceError } from "../errors";
import type { RuntimeProviderId, WorkspaceRuntimeProvider } from "../types";
import { DockerWorkspaceProvider } from "./docker";

const registry = new Map<RuntimeProviderId, WorkspaceRuntimeProvider>([
  ["docker", new DockerWorkspaceProvider()],
]);

/**
 * The only place the app learns which backend it is talking to. Kubernetes,
 * Firecracker or a remote VPS backend registers here and nothing else changes.
 */
export function getRuntimeProvider(runtimeType: string): WorkspaceRuntimeProvider {
  const provider = registry.get(runtimeType as RuntimeProviderId);
  if (!provider) {
    throw new WorkspaceError(`No runtime provider is registered for "${runtimeType}".`, "runtime_unavailable");
  }
  return provider;
}

export function listRuntimeProviders() {
  return [...registry.keys()];
}
