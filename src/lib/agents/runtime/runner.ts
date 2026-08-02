import { execFile, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import type { ChildProcessByStdio, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type SpawnedRuntimeProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface RuntimeProcessRunner {
  run(executable: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<CommandResult>;
  spawn(executable: string, args: string[], options: SpawnOptionsWithoutStdio): SpawnedRuntimeProcess;
  realpath(path: string): Promise<string>;
}

export class NodeRuntimeProcessRunner implements RuntimeProcessRunner {
  run(executable: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) {
    return new Promise<CommandResult>((resolve, reject) => {
      execFile(executable, args, {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 5_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: safeRuntimeEnvironment(),
      }, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ stdout, stderr, exitCode: typeof error?.code === "number" ? error.code : 0 });
      });
    });
  }

  spawn(executable: string, args: string[], options: SpawnOptionsWithoutStdio) {
    return spawn(executable, args, {
      ...options,
      shell: false,
      windowsHide: true,
      env: safeRuntimeEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  realpath(path: string) {
    return realpath(path);
  }
}

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM",
  "CLAUDE_CONFIG_DIR", "CODEX_HOME",
] as const;

export function safeRuntimeEnvironment(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) safe[key] = process.env[key];
  }
  return safe;
}

export const nodeRuntimeProcessRunner = new NodeRuntimeProcessRunner();
