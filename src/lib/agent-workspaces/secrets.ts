import { WorkspaceError } from "./errors";

/**
 * Secrets are resolved by Sentinel at call time and passed to the runtime as
 * per-exec environment variables. They are never baked into images, written to
 * the workspace volume, or persisted in command rows.
 */
export type SecretScope = "git";

const REDACTION = "[redacted]";

export function resolveSecrets(scope: SecretScope): Record<string, string> {
  if (scope !== "git") return {};
  const token = process.env.SENTINEL_WORKSPACE_GIT_TOKEN?.trim();
  if (!token) return {};
  return {
    // Consumed by the credential helper configured in the workspace image.
    GIT_ASKPASS: "/usr/local/bin/sentinel-git-askpass",
    SENTINEL_GIT_USERNAME: process.env.SENTINEL_WORKSPACE_GIT_USERNAME?.trim() || "x-access-token",
    SENTINEL_GIT_TOKEN: token,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function requireSecrets(scope: SecretScope) {
  const secrets = resolveSecrets(scope);
  if (!Object.keys(secrets).length) {
    throw new WorkspaceError(
      "No Git credentials are configured for workspace runtimes. Set SENTINEL_WORKSPACE_GIT_TOKEN on the Sentinel host.",
      "policy_violation",
    );
  }
  return secrets;
}

/** Strip any secret value that leaked into captured output before it is stored. */
export function redactSecrets(text: string, secrets: Record<string, string>) {
  let output = text;
  for (const value of Object.values(secrets)) {
    if (value.length >= 8) output = output.split(value).join(REDACTION);
  }
  return output;
}

export function secretKeys(secrets: Record<string, string>) {
  return Object.keys(secrets);
}
