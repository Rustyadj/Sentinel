import { relative, resolve, sep } from "node:path";
import type { RuntimeProcessRunner } from "./runner";
import { RuntimeError } from "./errors";

const CONTROL_CHARACTER = /[\0\r\n]/;

export function assertSafeOpaqueId(value: string, label: string) {
  if (!value || CONTROL_CHARACTER.test(value) || value.length > 512) {
    throw new RuntimeError(`${label} is invalid`, "invalid_argument", 400);
  }
}

export async function resolveAllowedWorkingDirectory(
  runner: RuntimeProcessRunner,
  root: string | undefined,
  requested: string | undefined,
) {
  if (!root) throw new RuntimeError("Runtime has no allowlisted project root", "configuration_invalid", 503);
  if (CONTROL_CHARACTER.test(root) || (requested && CONTROL_CHARACTER.test(requested))) {
    throw new RuntimeError("Working directory contains control characters", "invalid_working_directory", 400);
  }
  const canonicalRoot = await runner.realpath(resolve(root)).catch(() => {
    throw new RuntimeError("Allowlisted project root does not exist", "configuration_invalid", 503);
  });
  const canonicalRequested = await runner.realpath(resolve(requested ?? canonicalRoot)).catch(() => {
    throw new RuntimeError("Working directory does not exist", "invalid_working_directory", 400);
  });
  const child = relative(canonicalRoot, canonicalRequested);
  if (child === ".." || child.startsWith(`..${sep}`) || resolve(canonicalRequested) === resolve(sep)) {
    throw new RuntimeError("Working directory is outside the allowlisted project root", "working_directory_not_allowed", 403);
  }
  return canonicalRequested;
}
