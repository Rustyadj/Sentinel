// Learning Core — Sandbox execution boundary.
//
// "Do not call an ordinary in-process function a secure sandbox" (spec).
// This file defines the real interface and three adapters:
//   - DockerSandbox: the production isolation boundary. Real, but UNVERIFIED
//     against a live Docker daemon in this session — no Docker socket was
//     available to test against here. Stated honestly, not hidden.
//   - MockTestSandbox: explicitly test-only, documented as not a security
//     boundary, used so the calling code (candidate validation/promotion
//     gating) can be exercised without a Docker daemon in unit tests.
//   - UnavailableSandbox: the fail-closed default. If no real backend is
//     configured, every candidate that requires sandboxing is blocked, not
//     silently run unsandboxed.
//
// getSandbox() below is the only place call sites should get an instance —
// never construct an adapter directly, so the fail-closed default can't be
// bypassed by an import that skips the check.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

export interface SandboxExecutionInput {
  runId?: string;
  /** Command to run inside the isolated environment — never a raw shell string. */
  command: string[];
  /** Explicit env allowlist — the sandbox never inherits the host's process.env. */
  env?: Record<string, string>;
  timeoutMs?: number;
  memoryLimitMb?: number;
  cpuLimit?: number; // fractional CPUs, e.g. 0.5
}

export interface SandboxExecutionResult {
  runId: string;
  status: "completed" | "timeout" | "error" | "unavailable";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  reason?: string; // populated when status is "unavailable" or "error"
}

export interface LearningSandbox {
  readonly name: string;
  readonly isProductionSafe: boolean;
  validate(input: { command: string[] }): Promise<ValidationResult>;
  execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult>;
  destroy(runId: string): Promise<void>;
}

// Explicit allowlist, never process.env spread wholesale — PATH/NODE_ENV are
// needed to resolve and run the child process at all; nothing else host-side
// is inherited (matches @types/node's ProcessEnv requiring NODE_ENV present).
function restrictedEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    NODE_ENV: process.env.NODE_ENV,
    ...extra,
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_LIMIT_MB = 256;
const DEFAULT_CPU_LIMIT = 0.5;

// Nothing that looks like a credential, a network tool, or a shell escape is
// allowed through — this is a coarse allowlist-adjacent filter, not a
// substitute for the container boundary itself (both layers matter).
const DISALLOWED_COMMAND_PATTERN = /(curl|wget|nc\b|ssh|scp|rm\s+-rf\s+\/|sudo|chmod\s+777|;|\|\||&&|`|\$\()/i;

export class UnavailableSandbox implements LearningSandbox {
  readonly name = "unavailable";
  readonly isProductionSafe = true; // "safe" because it refuses to run anything, not because it isolates

  async validate(_input: { command: string[] }): Promise<ValidationResult> {
    return { valid: false, reasons: ["No sandbox backend is configured — candidate execution is unavailable, not unsandboxed."] };
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    return {
      runId: input.runId ?? randomUUID(),
      status: "unavailable",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      reason: "No sandbox backend is configured (LEARNING_SANDBOX_DOCKER_IMAGE unset). Failing closed rather than running unsandboxed.",
    };
  }

  async destroy(): Promise<void> {
    // Nothing was ever started.
  }
}

/**
 * Test-only. Runs the command in-process via child_process without any
 * container isolation, resource limits, or filesystem/network restriction.
 * NEVER select this adapter outside a test environment — getSandbox()
 * enforces that by only returning it when NODE_ENV === "test".
 */
export class MockTestSandbox implements LearningSandbox {
  readonly name = "mock-test-only";
  readonly isProductionSafe = false;

  async validate(input: { command: string[] }): Promise<ValidationResult> {
    const joined = input.command.join(" ");
    if (DISALLOWED_COMMAND_PATTERN.test(joined)) {
      return { valid: false, reasons: [`Command matches the disallowed pattern: "${joined}"`] };
    }
    if (input.command.length === 0) {
      return { valid: false, reasons: ["Empty command"] };
    }
    return { valid: true, reasons: [] };
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const runId = input.runId ?? randomUUID();
    const started = Date.now();
    const [cmd, ...args] = input.command;

    return new Promise((resolve) => {
      // PATH is kept so the test runner can resolve the command at all —
      // every other host env var is deliberately not inherited.
      const child = spawn(cmd, args, {
        env: restrictedEnv(input.env),
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
        resolve({
          runId,
          status: signal === "SIGTERM" ? "timeout" : "completed",
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      });
      child.on("error", (err: Error) => {
        resolve({
          runId,
          status: "error",
          exitCode: null,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          reason: err.message,
        });
      });
    });
  }

  async destroy(): Promise<void> {
    // child_process with a timeout self-terminates; nothing persistent to clean up.
  }
}

/**
 * Production adapter — real container isolation via `docker run`.
 *
 * UNVERIFIED IN THIS SESSION: no Docker daemon was reachable here to test
 * against. The flags below are real and intentional (see comments), but
 * this has not been exercised against a live container. Treat as
 * implemented-not-verified until it's run against a real Docker socket.
 */
export class DockerSandbox implements LearningSandbox {
  readonly name = "docker";
  readonly isProductionSafe = true;

  constructor(private readonly image: string) {}

  async validate(input: { command: string[] }): Promise<ValidationResult> {
    const joined = input.command.join(" ");
    if (DISALLOWED_COMMAND_PATTERN.test(joined)) {
      return { valid: false, reasons: [`Command matches the disallowed pattern: "${joined}"`] };
    }
    if (input.command.length === 0) {
      return { valid: false, reasons: ["Empty command"] };
    }
    return { valid: true, reasons: [] };
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const runId = input.runId ?? randomUUID();
    const containerName = `learning-sandbox-${runId}`;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryMb = input.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
    const cpus = input.cpuLimit ?? DEFAULT_CPU_LIMIT;
    const started = Date.now();

    const dockerArgs = [
      "run",
      "--rm", // deterministic cleanup — no leftover containers on normal exit
      "--name", containerName,
      "--network", "none", // no unrestricted network
      "--read-only", // no unrestricted filesystem
      "--tmpfs", "/tmp:size=64m", // the only writable path, and it's ephemeral
      "--memory", `${memoryMb}m`,
      "--cpus", String(cpus),
      "--pids-limit", "64",
      "--security-opt", "no-new-privileges",
      "--user", "1000:1000", // never root
    ];
    for (const [key, value] of Object.entries(input.env ?? {})) {
      dockerArgs.push("-e", `${key}=${value}`);
    }
    dockerArgs.push(this.image, ...input.command);

    return new Promise((resolve) => {
      const child = spawn("docker", dockerArgs, {
        env: restrictedEnv(),
        timeout: timeoutMs,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
        resolve({
          runId,
          status: signal === "SIGTERM" ? "timeout" : "completed",
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      });
      child.on("error", (err: Error) => {
        resolve({
          runId,
          status: "error",
          exitCode: null,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          reason: `docker run failed to start: ${err.message}`,
        });
      });
    });
  }

  async destroy(runId: string): Promise<void> {
    // Belt-and-suspenders on top of --rm, for a run killed early (timeout path).
    await new Promise<void>((resolve) => {
      const kill = spawn("docker", ["kill", `learning-sandbox-${runId}`]);
      kill.on("close", () => resolve());
      kill.on("error", () => resolve()); // container may already be gone — not an error condition here
    });
  }
}

let cachedSandbox: LearningSandbox | null = null;

/**
 * The only entry point call sites should use. Never construct an adapter
 * directly — that would let a caller accidentally bypass the fail-closed
 * default or select the test-only mock outside a test environment.
 */
export function getSandbox(): LearningSandbox {
  if (cachedSandbox) return cachedSandbox;

  if (process.env.NODE_ENV === "test") {
    cachedSandbox = new MockTestSandbox();
  } else {
    const image = process.env.LEARNING_SANDBOX_DOCKER_IMAGE;
    cachedSandbox = image ? new DockerSandbox(image) : new UnavailableSandbox();
  }
  return cachedSandbox;
}

/** Test-only: reset the cached adapter between test files. */
export function resetSandboxCache(): void {
  cachedSandbox = null;
}
