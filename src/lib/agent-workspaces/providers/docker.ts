import { execFile } from "node:child_process";
import { WorkspaceError, translateRuntimeFailure } from "../errors";
import { MAX_CAPTURED_OUTPUT_BYTES } from "../policy";
import {
  assertProjectedDiskUsage,
  loadWorkspaceDiskQuota,
  throwDiskFull,
  withWorkspaceDiskLock,
} from "../quota";
import type {
  CreateWorkspaceSpec, ExecRequest, ExecResult, FileEntry, ProcessEntry,
  RuntimeDescriptor, RuntimeStats, SnapshotRef, WorkspaceRuntimeProvider,
} from "../types";

const DOCKER_BIN = process.env.AGENT_WORKSPACE_DOCKER_BIN || "docker";
const SNAPSHOT_DIR = process.env.AGENT_WORKSPACE_SNAPSHOT_DIR || "/var/lib/sentinel/workspace-snapshots";
const HELPER_IMAGE = process.env.AGENT_WORKSPACE_HELPER_IMAGE || "alpine:3.20";
const RUN_USER = process.env.AGENT_WORKSPACE_USER || "10001:10001";
const LABEL_PREFIX = "io.sentinel.agent-workspace";
const QUOTA_EXCEEDED_MARKER = "[sentinel] workspace disk quota exceeded";

export function containerNameFor(workspaceId: string) {
  return `sentinel-ws-${workspaceId}`;
}
export function volumeNameFor(workspaceId: string) {
  return `sentinel-ws-data-${workspaceId}`;
}

interface RawResult { code: number; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }

/**
 * Every backend call goes through execFile with an argv array — never a shell
 * string — so no caller-supplied value can be reinterpreted as a docker flag
 * or a host shell command.
 */
function docker(args: string[], options: { timeoutMs?: number; stdin?: string; maxBytes?: number } = {}): Promise<RawResult> {
  const maxBytes = options.maxBytes ?? MAX_CAPTURED_OUTPUT_BYTES;
  return new Promise((resolvePromise) => {
    const child = execFile(
      DOCKER_BIN,
      args,
      { timeout: options.timeoutMs ?? 60_000, maxBuffer: maxBytes * 4, encoding: "utf8", killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null;
        const truncated = stdout.length > maxBytes || stderr.length > maxBytes;
        resolvePromise({
          code: typeof err?.code === "number" ? err.code : err ? 1 : 0,
          stdout: stdout.slice(0, maxBytes),
          stderr: stderr.slice(0, maxBytes),
          timedOut: Boolean(err?.killed || err?.signal === "SIGKILL"),
          truncated,
        });
      },
    );
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

async function dockerOrThrow(args: string[], options?: { timeoutMs?: number; stdin?: string }) {
  const result = await docker(args, options);
  if (result.code !== 0) throw translateRuntimeFailure(result.stderr || result.stdout);
  return result;
}

/**
 * Run a POSIX script inside the workspace. The script text is fixed by
 * Sentinel; caller data arrives as positional arguments, so it is data to the
 * shell, never code.
 */
function execScriptArgs(workspaceId: string, script: string, args: string[] = [], cwd?: string, user = RUN_USER, env: Record<string, string> = {}) {
  const flags = ["exec", "-i", "-u", user];
  if (cwd) flags.push("-w", cwd);
  for (const [key, value] of Object.entries(env)) flags.push("-e", `${key}=${value}`);
  return [...flags, containerNameFor(workspaceId), "sh", "-c", script, "sentinel-workspace", ...args];
}

function parseState(status: string, running: boolean, paused: boolean, exitCode: number) {
  if (paused) return "PAUSED" as const;
  if (running) return "RUNNING" as const;
  if (status === "created") return "STOPPED" as const;
  if (status === "removing") return "STOPPING" as const;
  // 137/143 are SIGKILL/SIGTERM — how a container exits when Sentinel stops
  // it. Only an unexpected non-zero exit is a real error state.
  if (status === "exited" && ![0, 130, 137, 143].includes(exitCode)) return "ERROR" as const;
  return "STOPPED" as const;
}

async function pathSize(workspaceId: string, path: string) {
  const result = await docker(execScriptArgs(workspaceId, 'if test -e "$1"; then du -sb "$1" 2>/dev/null | cut -f1; else printf "0\\n"; fi', [path]), { timeoutMs: 30_000 });
  if (result.code !== 0) throw translateRuntimeFailure(result.stderr || result.stdout, "command_failed");
  const bytes = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(bytes) ? bytes : 0;
}

async function regularFileSize(workspaceId: string, path: string) {
  const result = await docker(execScriptArgs(workspaceId, 'if test -f "$1"; then wc -c < "$1"; else printf "0\\n"; fi', [path]), { timeoutMs: 30_000 });
  if (result.code !== 0) throw translateRuntimeFailure(result.stderr || result.stdout, "command_failed");
  const bytes = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(bytes) ? bytes : 0;
}

async function workspaceDiskUsage(workspaceId: string, homePath: string) {
  return pathSize(workspaceId, homePath);
}

async function snapshotExpandedSize(storageRef: string) {
  const result = await docker([
    "run", "--rm", "--user", RUN_USER,
    "-v", `${SNAPSHOT_DIR}:/snapshots:ro`,
    HELPER_IMAGE,
    "sh", "-c",
    'gzip -dc "$1" | tar tvf - | awk \'$3 ~ /^[0-9]+$/ { total += $3 } END { printf "%.0f\\n", total }\'',
    "sentinel-snapshot-size", `/snapshots/${storageRef}`,
  ], { timeoutMs: 30 * 60 * 1000 });
  if (result.code !== 0) throw new WorkspaceError("Snapshot size could not be verified before restore.", "snapshot_failed", result.stderr || result.stdout);
  const bytes = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(bytes)) throw new WorkspaceError("Snapshot size could not be verified before restore.", "snapshot_failed");
  return bytes;
}

async function volumeDiskUsage(volumeName: string) {
  const result = await docker([
    "run", "--rm", "--user", RUN_USER,
    "-v", `${volumeName}:/data:ro`,
    HELPER_IMAGE,
    "sh", "-c", 'du -sb /data 2>/dev/null | cut -f1',
  ], { timeoutMs: 30 * 60 * 1000 });
  if (result.code !== 0) throw translateRuntimeFailure(result.stderr || result.stdout, "command_failed");
  const bytes = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(bytes) ? bytes : 0;
}

export class DockerWorkspaceProvider implements WorkspaceRuntimeProvider {
  readonly id = "docker" as const;

  async isAvailable() {
    const result = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
    if (result.code !== 0) return { available: false, reason: result.stderr.trim() || "docker CLI unavailable" };
    return { available: true };
  }

  async createWorkspace(spec: CreateWorkspaceSpec) {
    const volumeName = volumeNameFor(spec.workspaceId);
    const existing = await docker(["volume", "inspect", volumeName]);
    if (existing.code !== 0) {
      await dockerOrThrow([
        "volume", "create",
        "--label", `${LABEL_PREFIX}.workspace=${spec.workspaceId}`,
        "--label", `${LABEL_PREFIX}.agent=${spec.agentId}`,
        volumeName,
      ]);
      // Give the unprivileged runtime user ownership of its own home once, at
      // provisioning time, using a throwaway root helper — the workspace
      // container itself never runs as root.
      await dockerOrThrow([
        "run", "--rm", "-v", `${volumeName}:/data`, HELPER_IMAGE,
        "sh", "-c", `chown -R ${RUN_USER.replace(":", ":")} /data && chmod 750 /data`,
      ], { timeoutMs: 120_000 });
    }
    return { volumeName };
  }

  async startWorkspace(spec: CreateWorkspaceSpec & { volumeName: string }): Promise<RuntimeDescriptor> {
    const name = containerNameFor(spec.workspaceId);
    const existing = await this.getStatus(spec.workspaceId);
    if (existing?.state === "RUNNING") return existing;
    if (existing?.state === "PAUSED") return this.resumeWorkspace(spec.workspaceId);
    if (existing) {
      const started = await docker(["start", name], { timeoutMs: 120_000 });
      if (started.code === 0) return (await this.getStatus(spec.workspaceId))!;
      // Container exists but cannot start (stale config, missing image):
      // replace the runtime. The volume is untouched.
      await docker(["rm", "-f", name]);
    }

    const { limits } = spec;
    const args = [
      "run", "-d",
      "--name", name,
      "--label", `${LABEL_PREFIX}.workspace=${spec.workspaceId}`,
      "--label", `${LABEL_PREFIX}.agent=${spec.agentId}`,
      "--label", `${LABEL_PREFIX}.disk-limit-bytes=${Math.floor(spec.limits.diskGb * 1024 ** 3)}`,
      "--user", RUN_USER,
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", String(limits.pidsLimit),
      "--cpus", String(limits.cpus),
      "--memory", `${limits.memoryMb}m`,
      "--memory-swap", `${limits.memoryMb}m`,
      "--network", limits.network,
      "--restart", "no",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m",
      "-v", `${spec.volumeName}:${spec.homePath}`,
      "-w", spec.homePath,
      "-e", "HOME=" + spec.homePath,
      spec.image,
      "sleep", "infinity",
    ];
    const created = await docker(args, { timeoutMs: 180_000 });
    if (created.code !== 0) {
      const failure = translateRuntimeFailure(created.stderr || created.stdout, "runtime_start_failed");
      throw failure;
    }
    const status = await this.getStatus(spec.workspaceId);
    if (!status) throw new WorkspaceError("The workspace runtime failed to report a state after start.", "runtime_start_failed");
    return status;
  }

  async stopWorkspace(workspaceId: string) {
    await dockerOrThrow(["stop", "-t", "10", containerNameFor(workspaceId)], { timeoutMs: 60_000 });
    return (await this.getStatus(workspaceId)) ?? this.absentDescriptor();
  }

  async pauseWorkspace(workspaceId: string) {
    await dockerOrThrow(["pause", containerNameFor(workspaceId)]);
    return (await this.getStatus(workspaceId)) ?? this.absentDescriptor();
  }

  async resumeWorkspace(workspaceId: string) {
    await dockerOrThrow(["unpause", containerNameFor(workspaceId)]);
    return (await this.getStatus(workspaceId)) ?? this.absentDescriptor();
  }

  async restartWorkspace(spec: CreateWorkspaceSpec & { volumeName: string }) {
    const existing = await this.getStatus(spec.workspaceId);
    if (existing) {
      await docker(["stop", "-t", "10", containerNameFor(spec.workspaceId)], { timeoutMs: 60_000 });
      // Resource limits are container creation settings. Recreate compute on an
      // explicit restart so the latest limits take effect; the named data
      // volume remains untouched.
      await dockerOrThrow(["rm", containerNameFor(spec.workspaceId)], { timeoutMs: 60_000 });
    }
    return this.startWorkspace(spec);
  }

  private absentDescriptor(): RuntimeDescriptor {
    return { runtimeId: "", provider: "docker", state: "STOPPED", image: "" };
  }

  async getStatus(workspaceId: string): Promise<RuntimeDescriptor | null> {
    const name = containerNameFor(workspaceId);
    const result = await docker([
      "inspect", name,
      "--format", "{{.Id}}\t{{.State.Status}}\t{{.State.Running}}\t{{.State.Paused}}\t{{.State.ExitCode}}\t{{.State.StartedAt}}\t{{.Config.Image}}\t{{.State.Error}}",
    ], { timeoutMs: 20_000 });
    if (result.code !== 0) {
      if (/no such object|no such container/i.test(result.stderr)) return null;
      throw translateRuntimeFailure(result.stderr);
    }
    const [id, status, running, paused, exitCode, startedAt, image, error] = result.stdout.trim().split("\t");
    const state = parseState(status, running === "true", paused === "true", Number(exitCode));
    return {
      runtimeId: id,
      provider: "docker",
      state,
      containerId: id,
      containerName: name,
      image,
      startedAt: startedAt && !startedAt.startsWith("0001") ? new Date(startedAt).toISOString() : undefined,
      errorCode: state === "ERROR" ? "container_exited" : undefined,
      errorMessage: error?.trim() ? error.trim() : state === "ERROR" ? `Container exited with code ${exitCode}` : undefined,
    };
  }

  async getStats(workspaceId: string): Promise<RuntimeStats> {
    const empty: RuntimeStats = {
      cpuPercent: null, memoryBytes: null, memoryLimitBytes: null,
      diskUsedBytes: null, processCount: null, uptimeSeconds: null,
    };
    const status = await this.getStatus(workspaceId);
    if (!status || status.state !== "RUNNING") return empty;

    const stats = await docker(
      ["stats", "--no-stream", "--format", "{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}", containerNameFor(workspaceId)],
      { timeoutMs: 20_000 },
    );
    const result: RuntimeStats = { ...empty };
    if (status.startedAt) result.uptimeSeconds = Math.max(0, Math.round((Date.now() - Date.parse(status.startedAt)) / 1000));
    if (stats.code === 0) {
      const [cpu, mem, pids] = stats.stdout.trim().split("\t");
      const cpuValue = Number.parseFloat(cpu?.replace("%", "") ?? "");
      result.cpuPercent = Number.isFinite(cpuValue) ? cpuValue : null;
      const [used, limit] = (mem ?? "").split("/").map((part) => parseSize(part.trim()));
      result.memoryBytes = used;
      result.memoryLimitBytes = limit;
      const pidCount = Number.parseInt(pids ?? "", 10);
      result.processCount = Number.isFinite(pidCount) ? pidCount : null;
    }
    const quota = await loadWorkspaceDiskQuota(workspaceId).catch(() => null);
    if (quota) result.diskUsedBytes = await workspaceDiskUsage(workspaceId, quota.homePath).catch(() => null);
    return result;
  }

  async executeCommand(request: ExecRequest): Promise<ExecResult> {
    return withWorkspaceDiskLock(request.workspaceId, async () => {
      const startedAt = Date.now();
      const status = await this.getStatus(request.workspaceId);
      if (!status) throw new WorkspaceError("The workspace runtime does not exist. Start it first.", "runtime_not_found");
      if (status.state !== "RUNNING") {
        throw new WorkspaceError(`The workspace runtime is ${status.state.toLowerCase()}. Start it before running commands.`, "runtime_not_running");
      }
      const quota = await loadWorkspaceDiskQuota(request.workspaceId);
      const usedBefore = await workspaceDiskUsage(request.workspaceId, quota.homePath);
      await assertProjectedDiskUsage({
        workspaceId: request.workspaceId,
        operation: "command execution",
        usedBytes: usedBefore,
        limitBytes: quota.limitBytes,
      });

      const quotaScript = [
        'limit="$1"; root="$2"; command="$3"',
        'bash -lc "$command" 0<&0 & command_pid=$!',
        'quota_hit=0',
        'while kill -0 "$command_pid" 2>/dev/null; do',
        '  used=$(du -sb "$root" 2>/dev/null | cut -f1)',
        '  if test -n "$used" && test "$used" -gt "$limit"; then',
        '    quota_hit=1; kill -TERM "$command_pid" 2>/dev/null || true; sleep 0.2; kill -KILL "$command_pid" 2>/dev/null || true; break',
        '  fi',
        '  sleep 0.2',
        'done',
        'wait "$command_pid"; command_code=$?',
        `if test "$quota_hit" -eq 1; then printf '${QUOTA_EXCEEDED_MARKER}\\n' >&2; exit 125; fi`,
        'exit "$command_code"',
      ].join("\n");
      const args = ["exec", "-i", "-u", RUN_USER];
      if (request.cwd) args.push("-w", request.cwd);
      for (const [key, value] of Object.entries(request.env ?? {})) args.push("-e", `${key}=${value}`);
      args.push(
        containerNameFor(request.workspaceId),
        "bash", "-c", quotaScript, "sentinel-quota",
        String(quota.limitBytes), quota.homePath, request.command,
      );

      const result = await docker(args, { timeoutMs: request.timeoutMs ?? 120_000, stdin: request.stdin });
      const usedAfter = await workspaceDiskUsage(request.workspaceId, quota.homePath).catch(() => usedBefore);
      if (result.stderr.includes(QUOTA_EXCEEDED_MARKER) || /no space left on device/i.test(result.stderr) || usedAfter > quota.limitBytes) {
        await throwDiskFull({
          workspaceId: request.workspaceId,
          operation: "command execution",
          usedBytes: usedAfter,
          limitBytes: quota.limitBytes,
        });
      }
      return {
        exitCode: result.timedOut ? 124 : result.code,
        stdout: result.stdout,
        stderr: result.timedOut ? `${result.stderr}\n[sentinel] command exceeded its timeout and was terminated`.trim() : result.stderr,
        durationMs: Date.now() - startedAt,
        timedOut: result.timedOut,
        truncated: result.truncated,
      };
    });
  }

  async readFile(workspaceId: string, path: string, maxBytes: number) {
    const sizeResult = await docker(execScriptArgs(workspaceId, 'test -f "$1" || exit 66; wc -c < "$1"', [path]));
    if (sizeResult.code === 66) throw new WorkspaceError("File not found.", "file_not_found");
    if (sizeResult.code !== 0) throw translateRuntimeFailure(sizeResult.stderr, "file_not_found");
    const sizeBytes = Number.parseInt(sizeResult.stdout.trim(), 10) || 0;
    if (sizeBytes > maxBytes) {
      throw new WorkspaceError(`File is larger than the ${Math.round(maxBytes / 1024)} KB inline read limit. Download it as an artifact instead.`, "file_too_large");
    }
    const read = await docker(execScriptArgs(workspaceId, 'base64 "$1"', [path]), { maxBytes: maxBytes * 2 });
    if (read.code !== 0) throw translateRuntimeFailure(read.stderr, "file_not_found");
    const buffer = Buffer.from(read.stdout.replace(/\s+/g, ""), "base64");
    const binary = buffer.subarray(0, 8000).includes(0);
    return binary
      ? { content: buffer.toString("base64"), encoding: "base64" as const, sizeBytes }
      : { content: buffer.toString("utf8"), encoding: "utf8" as const, sizeBytes };
  }

  async writeFile(workspaceId: string, path: string, content: string, encoding: "utf8" | "base64") {
    return withWorkspaceDiskLock(workspaceId, async () => {
      const payload = encoding === "base64" ? content : Buffer.from(content, "utf8").toString("base64");
      const incomingBytes = Buffer.from(payload, "base64").byteLength;
      const quota = await loadWorkspaceDiskQuota(workspaceId);
      const [usedBytes, replacedBytes] = await Promise.all([
        workspaceDiskUsage(workspaceId, quota.homePath),
        regularFileSize(workspaceId, path),
      ]);
      await assertProjectedDiskUsage({
        workspaceId,
        operation: `write ${path}`,
        usedBytes: Math.max(0, usedBytes - replacedBytes),
        addedBytes: incomingBytes,
        limitBytes: quota.limitBytes,
      });
      const result = await docker(
        execScriptArgs(workspaceId, 'mkdir -p "$(dirname "$1")" && base64 -d > "$1"', [path]),
        { stdin: payload, timeoutMs: 60_000 },
      );
      if (result.code !== 0) throw translateRuntimeFailure(result.stderr, "command_failed");
    });
  }

  async listFiles(workspaceId: string, path: string): Promise<FileEntry[]> {
    const script = 'test -d "$1" || exit 66; find "$1" -mindepth 1 -maxdepth 1 -printf "%y\\t%s\\t%T@\\t%m\\t%f\\n"';
    const result = await docker(execScriptArgs(workspaceId, script, [path]), { timeoutMs: 30_000 });
    if (result.code === 66) throw new WorkspaceError("Directory not found.", "file_not_found");
    if (result.code !== 0) throw translateRuntimeFailure(result.stderr, "file_not_found");
    const entries = result.stdout.split("\n").filter(Boolean).map((line) => {
      const [type, size, mtime, mode, name] = line.split("\t");
      return {
        name,
        path: `${path.replace(/\/$/, "")}/${name}`,
        type: type === "d" ? "directory" : type === "l" ? "symlink" : "file",
        sizeBytes: Number.parseInt(size, 10) || 0,
        modifiedAt: new Date(Number.parseFloat(mtime) * 1000).toISOString(),
        mode: mode ?? "",
      } satisfies FileEntry;
    });
    // Directories first, then names — sorted here rather than in the shell so
    // the ordering does not depend on the guest's locale or sort(1) dialect.
    return entries.sort((left, right) =>
      left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1);
  }

  async deletePath(workspaceId: string, path: string, recursive: boolean) {
    const script = recursive ? 'rm -rf -- "$1"' : 'rm -f -- "$1"';
    const result = await docker(execScriptArgs(workspaceId, script, [path]));
    if (result.code !== 0) throw translateRuntimeFailure(result.stderr, "command_failed");
  }

  async movePath(workspaceId: string, from: string, to: string) {
    const result = await docker(execScriptArgs(workspaceId, 'mkdir -p "$(dirname "$2")" && mv -- "$1" "$2"', [from, to]));
    if (result.code !== 0) throw translateRuntimeFailure(result.stderr, "command_failed");
  }

  async copyPath(workspaceId: string, from: string, to: string) {
    return withWorkspaceDiskLock(workspaceId, async () => {
      const quota = await loadWorkspaceDiskQuota(workspaceId);
      const [usedBytes, sourceBytes] = await Promise.all([
        workspaceDiskUsage(workspaceId, quota.homePath),
        pathSize(workspaceId, from),
      ]);
      await assertProjectedDiskUsage({
        workspaceId,
        operation: `copy ${from} to ${to}`,
        usedBytes,
        addedBytes: sourceBytes,
        limitBytes: quota.limitBytes,
      });
      const result = await docker(execScriptArgs(workspaceId, 'mkdir -p "$(dirname "$2")" && cp -a -- "$1" "$2"', [from, to]));
      if (result.code !== 0) throw translateRuntimeFailure(result.stderr, "command_failed");
    });
  }

  async searchFiles(workspaceId: string, root: string, query: string, limit: number) {
    const result = await docker(
      execScriptArgs(workspaceId, 'grep -rIn --exclude-dir=.git --exclude-dir=node_modules -m 5 -e "$2" -- "$1" 2>/dev/null | head -n "$3"', [root, query, String(limit)]),
      { timeoutMs: 45_000 },
    );
    return result.stdout.split("\n").filter(Boolean).map((line) => {
      const first = line.indexOf(":");
      const second = line.indexOf(":", first + 1);
      return {
        path: line.slice(0, first),
        line: Number.parseInt(line.slice(first + 1, second), 10) || 0,
        text: line.slice(second + 1).slice(0, 400),
      };
    });
  }

  async getProcesses(workspaceId: string): Promise<ProcessEntry[]> {
    const result = await docker(
      execScriptArgs(workspaceId, 'ps -eo pid=,pcpu=,rss=,etimes=,args= 2>/dev/null'),
      { timeoutMs: 20_000 },
    );
    if (result.code !== 0) return [];
    const now = Date.now();
    const entries: ProcessEntry[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      const [, pid, cpu, rss, etimes, command] = match;
      // The keep-alive process is an implementation detail, not agent work.
      if (command === "sleep infinity") continue;
      entries.push({
        pid: Number.parseInt(pid, 10),
        command: command.slice(0, 500),
        cpuPercent: Number.parseFloat(cpu),
        memoryBytes: Number.parseInt(rss, 10) * 1024,
        startedAt: new Date(now - Number.parseInt(etimes, 10) * 1000).toISOString(),
      });
    }
    return entries;
  }

  async killProcess(workspaceId: string, pid: number) {
    if (!Number.isInteger(pid) || pid <= 1) throw new WorkspaceError("Invalid process id.", "invalid_body");
    const result = await docker(execScriptArgs(workspaceId, 'kill -TERM "$1" 2>/dev/null || kill -KILL "$1"', [String(pid)]));
    if (result.code !== 0) throw new WorkspaceError("The process could not be terminated.", "command_failed", result.stderr);
  }

  /**
   * Snapshots read the data volume through a throwaway helper container, so
   * they work whether or not the workspace runtime is up.
   */
  async createSnapshot(workspaceId: string, volumeName: string, snapshotId: string): Promise<SnapshotRef> {
    const file = `${workspaceId}__${snapshotId}.tar.gz`;
    const result = await docker([
      "run", "--rm",
      "-v", `${volumeName}:/data:ro`,
      "-v", `${SNAPSHOT_DIR}:/snapshots`,
      HELPER_IMAGE,
      "sh", "-c", `mkdir -p /snapshots && tar czf "/snapshots/${file}.part" -C /data . && mv "/snapshots/${file}.part" "/snapshots/${file}" && stat -c %s "/snapshots/${file}"`,
    ], { timeoutMs: 30 * 60 * 1000 });
    if (result.code !== 0) {
      throw new WorkspaceError("Snapshot creation failed.", "snapshot_failed", result.stderr || result.stdout);
    }
    return { storageRef: file, sizeBytes: Number.parseInt(result.stdout.trim().split("\n").pop() ?? "0", 10) || 0 };
  }

  async restoreSnapshot(workspaceId: string, volumeName: string, storageRef: string) {
    if (!/^[\w.-]+\.tar\.gz$/.test(storageRef)) throw new WorkspaceError("Invalid snapshot reference.", "invalid_body");
    return withWorkspaceDiskLock(workspaceId, async () => {
      const quota = await loadWorkspaceDiskQuota(workspaceId);
      const expandedBytes = await snapshotExpandedSize(storageRef);
      await assertProjectedDiskUsage({
        workspaceId,
        operation: `restore snapshot ${storageRef}`,
        usedBytes: 0,
        addedBytes: expandedBytes,
        limitBytes: quota.limitBytes,
      });
      const result = await docker([
        "run", "--rm",
        "-v", `${volumeName}:/data`,
        "-v", `${SNAPSHOT_DIR}:/snapshots:ro`,
        HELPER_IMAGE,
        "sh", "-c", `test -f "/snapshots/${storageRef}" && find /data -mindepth 1 -delete && tar xzf "/snapshots/${storageRef}" -C /data`,
      ], { timeoutMs: 30 * 60 * 1000 });
      if (result.code !== 0) {
        throw new WorkspaceError("Snapshot restore failed. The workspace data was left as-is.", "snapshot_failed", result.stderr || result.stdout);
      }
      const usedBytes = await volumeDiskUsage(volumeName);
      if (usedBytes > quota.limitBytes) {
        await throwDiskFull({ workspaceId, operation: `restore snapshot ${storageRef}`, usedBytes, limitBytes: quota.limitBytes });
      }
    });
  }

  async deleteSnapshot(storageRef: string) {
    if (!/^[\w.-]+\.tar\.gz$/.test(storageRef)) throw new WorkspaceError("Invalid snapshot reference.", "invalid_body");
    await docker([
      "run", "--rm", "-v", `${SNAPSHOT_DIR}:/snapshots`, HELPER_IMAGE,
      "sh", "-c", `rm -f "/snapshots/${storageRef}"`,
    ], { timeoutMs: 60_000 });
  }

  /** Compute only. The named volume is intentionally left in place. */
  async destroyRuntime(workspaceId: string) {
    const result = await docker(["rm", "-f", containerNameFor(workspaceId)], { timeoutMs: 60_000 });
    if (result.code !== 0 && !/no such container/i.test(result.stderr)) {
      throw translateRuntimeFailure(result.stderr);
    }
  }

  async destroyWorkspaceData(volumeName: string) {
    const result = await docker(["volume", "rm", "-f", volumeName], { timeoutMs: 60_000 });
    if (result.code !== 0 && !/no such volume/i.test(result.stderr)) {
      throw translateRuntimeFailure(result.stderr);
    }
  }
}

function parseSize(value: string): number | null {
  const match = value.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return null;
  const scale: Record<string, number> = { b: 1, kib: 1024, kb: 1000, mib: 1024 ** 2, mb: 1000 ** 2, gib: 1024 ** 3, gb: 1000 ** 3, tib: 1024 ** 4, tb: 1000 ** 4 };
  return Math.round(Number.parseFloat(match[1]) * (scale[match[2].toLowerCase()] ?? 1));
}
