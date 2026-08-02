import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { nodeRuntimeProcessRunner } from "./runner";
import { RuntimeError } from "./errors";
import type { RuntimeInstance } from "./types";

export interface RuntimeRepository {
  id: string;
  name: string;
  branch: string | null;
  dirty: boolean | null;
}

export async function listRuntimeRepositories(runtime: RuntimeInstance): Promise<RuntimeRepository[]> {
  if (!runtime.workingDirectoryRoot) return [];
  const root = await nodeRuntimeProcessRunner.realpath(runtime.workingDirectoryRoot).catch(() => {
    throw new RuntimeError("Allowlisted project root is unavailable", "configuration_invalid", 503);
  });
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).slice(0, 100);
  const repositories: RuntimeRepository[] = [];
  for (const entry of directories) {
    const candidate = await nodeRuntimeProcessRunner.realpath(join(root, entry.name)).catch(() => null);
    if (!candidate) continue;
    const child = relative(root, candidate);
    if (child === ".." || child.startsWith(`..${sep}`)) continue;
    if (!(await stat(join(candidate, ".git")).catch(() => null))) continue;
    const [branch, status] = await Promise.all([
      nodeRuntimeProcessRunner.run("git", ["branch", "--show-current"], { cwd: candidate, timeoutMs: 3_000 }).catch(() => null),
      nodeRuntimeProcessRunner.run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: candidate, timeoutMs: 3_000 }).catch(() => null),
    ]);
    repositories.push({
      id: candidate,
      name: entry.name,
      branch: branch?.exitCode === 0 ? branch.stdout.trim() || "detached" : null,
      dirty: status?.exitCode === 0 ? Boolean(status.stdout.trim()) : null,
    });
  }
  return repositories;
}
