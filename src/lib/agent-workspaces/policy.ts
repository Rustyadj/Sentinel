import posix from "node:path/posix";
import { WorkspaceError } from "./errors";
import type { RuntimeClient, WorkspacePolicy, WorkspaceResourceLimits } from "./types";

export const DEFAULT_LIMITS: WorkspaceResourceLimits = {
  cpus: 2,
  memoryMb: 4096,
  diskGb: 20,
  pidsLimit: 512,
  commandTimeoutMs: 120_000,
  idleTimeoutMs: 60 * 60 * 1000,
  network: "bridge",
};

export const MAX_LIMITS: WorkspaceResourceLimits = {
  cpus: 16,
  memoryMb: 65_536,
  diskGb: 500,
  pidsLimit: 4096,
  commandTimeoutMs: 30 * 60 * 1000,
  idleTimeoutMs: 24 * 60 * 60 * 1000,
  network: "bridge",
};

export const DEFAULT_POLICY: WorkspacePolicy = {
  // Enforced in `assertDelegationAllowed`, not merely stated in a prompt.
  crossAgentDelegation: "explicit-only",
  allowedRuntimeClients: ["hermes", "claude-code", "codex", "sentinel-ui"],
};

/** Hard ceiling on captured output per stream, to keep audit rows bounded. */
export const MAX_CAPTURED_OUTPUT_BYTES = 256 * 1024;
export const MAX_FILE_READ_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_WRITE_BYTES = 8 * 1024 * 1024;

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseLimits(raw: unknown): WorkspaceResourceLimits {
  const input = (raw ?? {}) as Partial<WorkspaceResourceLimits>;
  return {
    cpus: clampNumber(input.cpus, DEFAULT_LIMITS.cpus, 0.25, MAX_LIMITS.cpus),
    memoryMb: clampNumber(input.memoryMb, DEFAULT_LIMITS.memoryMb, 256, MAX_LIMITS.memoryMb),
    diskGb: clampNumber(input.diskGb, DEFAULT_LIMITS.diskGb, 1, MAX_LIMITS.diskGb),
    pidsLimit: clampNumber(input.pidsLimit, DEFAULT_LIMITS.pidsLimit, 16, MAX_LIMITS.pidsLimit),
    commandTimeoutMs: clampNumber(input.commandTimeoutMs, DEFAULT_LIMITS.commandTimeoutMs, 1_000, MAX_LIMITS.commandTimeoutMs),
    idleTimeoutMs: clampNumber(input.idleTimeoutMs, DEFAULT_LIMITS.idleTimeoutMs, 60_000, MAX_LIMITS.idleTimeoutMs),
    network: input.network === "none" ? "none" : "bridge",
  };
}

export function parsePolicy(raw: unknown): WorkspacePolicy {
  const input = (raw ?? {}) as Partial<WorkspacePolicy>;
  const mode = input.crossAgentDelegation;
  const allowed = Array.isArray(input.allowedRuntimeClients) && input.allowedRuntimeClients.length
    ? input.allowedRuntimeClients
    : DEFAULT_POLICY.allowedRuntimeClients;
  return {
    crossAgentDelegation:
      mode === "allowed" || mode === "denied" || mode === "explicit-only" ? mode : DEFAULT_POLICY.crossAgentDelegation,
    allowedRuntimeClients: allowed,
  };
}

export function assertClientAllowed(policy: WorkspacePolicy, client: RuntimeClient) {
  if (client === "system") return;
  if (!policy.allowedRuntimeClients.includes(client)) {
    throw new WorkspaceError(`Runtime client "${client}" is not permitted in this workspace.`, "policy_violation");
  }
}

/**
 * The orchestration rule the operator asked for, enforced in code: Claude Code
 * and Codex are independent execution clients. One never hands work to the
 * other unless this specific run carries an explicit, operator-supplied
 * authorisation.
 */
export function assertDelegationAllowed(input: {
  policy: WorkspacePolicy;
  fromClient: RuntimeClient;
  toClient: RuntimeClient;
  explicitAuthorization?: { authorizedByUserId: string; reason: string } | null;
}) {
  const { policy, fromClient, toClient, explicitAuthorization } = input;
  if (fromClient === toClient) return;
  if (policy.crossAgentDelegation === "denied") {
    throw new WorkspaceError(
      `Cross-client delegation is disabled for this workspace (${fromClient} -> ${toClient}).`,
      "policy_violation",
    );
  }
  if (policy.crossAgentDelegation === "allowed") return;
  if (!explicitAuthorization?.authorizedByUserId || !explicitAuthorization.reason?.trim()) {
    throw new WorkspaceError(
      `${fromClient} may not delegate to ${toClient} without explicit operator authorization.`,
      "policy_violation",
    );
  }
}

const CONTROL_CHARACTER = /[\0\r\n]/;

/**
 * Resolve a caller-supplied path against the workspace home. Purely lexical on
 * purpose: it runs before the path reaches the runtime, so a `..` chain can
 * never be handed to the backend. Symlink escapes are separately prevented by
 * the container boundary — the process only ever sees its own mount.
 */
export function resolveWorkspacePath(homePath: string, requested: string | undefined): string {
  const home = posix.resolve(homePath);
  if (requested === undefined || requested === "") return home;
  if (CONTROL_CHARACTER.test(requested) || requested.length > 4096) {
    throw new WorkspaceError("Path contains invalid characters.", "invalid_body");
  }
  // An absolute path is interpreted relative to the workspace root, except
  // when it is already inside it — callers legitimately pass back a path this
  // function returned, and re-prefixing would produce /workspace/workspace/...
  const alreadyInsideHome = requested === home || requested.startsWith(`${home}/`);
  const resolved = alreadyInsideHome
    ? posix.resolve(requested)
    : posix.resolve(home, requested.startsWith("/") ? `.${requested}` : requested);
  if (resolved !== home && !resolved.startsWith(`${home}/`)) {
    throw new WorkspaceError("Path escapes the workspace root.", "path_escape");
  }
  return resolved;
}

/** Reject shell metacharacters that would break out of the audited command. */
export function assertCommandShape(command: string) {
  if (!command.trim()) throw new WorkspaceError("Command is required.", "invalid_body");
  if (command.length > 16_000) throw new WorkspaceError("Command is too long.", "invalid_body");
  if (command.includes("\0")) throw new WorkspaceError("Command contains a null byte.", "invalid_body");
}
