import { WorkspaceError } from "./errors";

/**
 * Secrets are resolved by Sentinel at call time and passed to the runtime as
 * per-exec environment variables. They are never baked into images, written to
 * the workspace volume, or persisted in command rows.
 */
export type SecretScope = "git";

const REDACTION = "[redacted]";

export function resolveSecrets(scope: SecretScope, agentId?: string): Record<string, string> {
  if (scope !== "git") return {};
  const prefix = agentId === "claude-code" ? "SENTINEL_CLAUDE_CODE_GIT" : agentId === "codex" ? "SENTINEL_CODEX_GIT" : "SENTINEL_WORKSPACE_GIT";
  const token = process.env[`${prefix}_TOKEN`]?.trim();
  if (!token) return {};
  return {
    // Consumed by the credential helper configured in the workspace image.
    GIT_ASKPASS: "/usr/local/bin/sentinel-git-askpass",
    SENTINEL_GIT_USERNAME: process.env[`${prefix}_USERNAME`]?.trim() || "x-access-token",
    SENTINEL_GIT_TOKEN: token,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function requireSecrets(scope: SecretScope, agentId?: string) {
  const secrets = resolveSecrets(scope, agentId);
  if (!Object.keys(secrets).length) {
    throw new WorkspaceError(
      `No Git credentials are configured for ${agentId ?? "workspace runtimes"}. Configure its scoped Git token on the Sentinel host.`,
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
