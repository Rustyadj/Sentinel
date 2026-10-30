import { randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";
import { ModelUnavailableError, type EffortLevel } from "@/lib/agents/model-policy";
import { QUEUE_PREFIX } from "@/lib/queue-prefix";
import { RuntimeError } from "./errors";
import type { AgentRuntimeKind, RuntimeEvent } from "./types";

/**
 * Where CLI runtimes (Claude Code, Codex, Gemini) execute.
 *
 * The internet-facing app holds neither the CLI binaries nor their OAuth
 * credentials (docs/SECURITY_REMEDIATION.md §3, step 4). Every CLI operation —
 * health checks included, since they run the binary — is sent to
 * orchestration-worker, which has both, over a BullMQ queue, and the worker
 * streams the result back on a per-call Redis stream.
 *
 *   SENTINEL_CLI_RUNTIME_HOST=true   this process runs the CLIs (orchestration-worker)
 *   SENTINEL_CLI_RUNTIME_HOST=false  this process delegates to the worker
 *   unset                            delegate in production, run locally otherwise
 *
 * Production fails closed: an app that forgot the variable delegates, it never
 * looks for a local binary.
 */
export type CliRuntimeExecution = "local" | "worker";

export function cliRuntimeExecution(): CliRuntimeExecution {
  const host = process.env.SENTINEL_CLI_RUNTIME_HOST?.trim().toLowerCase();
  if (host === "true") return "local";
  if (host === "false") return "worker";
  return process.env.NODE_ENV === "production" ? "worker" : "local";
}

export const CLI_RUNTIME_KINDS = ["claude-code", "codex", "gemini"] as const satisfies readonly AgentRuntimeKind[];
export type CliRuntimeKind = (typeof CLI_RUNTIME_KINDS)[number];

export function isCliRuntimeKind(kind: string): kind is CliRuntimeKind {
  return (CLI_RUNTIME_KINDS as readonly string[]).includes(kind);
}

export const RUNTIME_CALL_QUEUE_NAME = "runtime-calls";

/** Adapter methods that execute the CLI, plus the installed-CLI effort catalog. Everything else is a database read and stays in the app. */
export const RUNTIME_CALL_METHODS = [
  "discover", "health", "readiness", "startSession", "resumeSession", "send", "cancel", "effortOptions",
] as const;
export type RuntimeCallMethod = (typeof RUNTIME_CALL_METHODS)[number];

export function isRuntimeCallMethod(value: unknown): value is RuntimeCallMethod {
  return typeof value === "string" && (RUNTIME_CALL_METHODS as readonly string[]).includes(value);
}

export interface RuntimeCallRequest {
  kind: CliRuntimeKind;
  method: RuntimeCallMethod;
  args: unknown[];
}

export interface RuntimeCallPayload extends RuntimeCallRequest {
  callId: string;
}

export type SerializedRuntimeError =
  | { name: "RuntimeError"; message: string; code: string; status: RuntimeError["status"] }
  | { name: "ModelUnavailableError"; kind: AgentRuntimeKind; requestedModel: string; requestedEffort: EffortLevel | null; reason: string }
  | { name: "Error"; message: string };

export type RuntimeCallReply =
  | { t: "accepted" }
  | { t: "alive" }
  | { t: "event"; event: RuntimeEvent }
  | { t: "result"; value: unknown }
  | { t: "error"; error: SerializedRuntimeError };

const MAX_ERROR_MESSAGE = 2_000;

export function serializeRuntimeError(error: unknown): SerializedRuntimeError {
  if (error instanceof ModelUnavailableError) {
    return { name: "ModelUnavailableError", kind: error.kind, requestedModel: error.requestedModel, requestedEffort: error.requestedEffort, reason: error.reason };
  }
  if (error instanceof RuntimeError) {
    return { name: "RuntimeError", message: error.message.slice(0, MAX_ERROR_MESSAGE), code: error.code, status: error.status };
  }
  return { name: "Error", message: (error instanceof Error ? error.message : "Runtime execution failed").slice(0, MAX_ERROR_MESSAGE) };
}

/** Rebuilds the error class the caller would have caught in-process, so routes map it to the same status and body. */
export function deserializeRuntimeError(error: SerializedRuntimeError): Error {
  if (error.name === "ModelUnavailableError") {
    return new ModelUnavailableError(error.kind, error.requestedModel, error.requestedEffort, error.reason);
  }
  if (error.name === "RuntimeError") return new RuntimeError(error.message, error.code, error.status);
  return new Error(error.message);
}

export function replyStreamKey(callId: string): string {
  return `${QUEUE_PREFIX}:runtime-call:${callId}`;
}

/** Replies outlive the call long enough for a slow reader, and no longer. */
export const REPLY_TTL_SECONDS = 15 * 60;
/** The worker writes `alive` this often while a call runs, so a dead worker is noticed in seconds, not at the CLI's own timeout. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** How long a call may sit on the queue before the app reports the worker as unavailable. */
const ACCEPT_TIMEOUT_MS = 30_000;
/** Silence after acceptance longer than this means the worker died mid-call. */
const IDLE_TIMEOUT_MS = 45_000;
const BLOCK_MS = 5_000;

export interface RuntimeCallTransport {
  call(request: RuntimeCallRequest): AsyncIterable<RuntimeCallReply>;
}

function connection(): ConnectionOptions | null {
  return process.env.REDIS_URL ? { url: process.env.REDIS_URL, maxRetriesPerRequest: null } : null;
}

let queue: Queue<RuntimeCallPayload> | null = null;

function runtimeCallQueue(): Queue<RuntimeCallPayload> {
  const options = connection();
  if (!options) {
    throw new RuntimeError("REDIS_URL is required: CLI runtimes execute in orchestration-worker.", "runtime_host_unavailable", 503);
  }
  queue ??= new Queue<RuntimeCallPayload>(RUNTIME_CALL_QUEUE_NAME, { connection: options, prefix: QUEUE_PREFIX });
  return queue;
}

function unavailable(message: string) {
  return new RuntimeError(message, "runtime_host_unavailable", 503);
}

/**
 * App side: enqueue one call and read its replies. A blocking XREAD needs a
 * connection to itself, so each call opens one and closes it when done.
 */
export const queueRuntimeCallTransport: RuntimeCallTransport = {
  async *call(request) {
    const target = runtimeCallQueue();
    const callId = randomUUID();
    const key = replyStreamKey(callId);
    const reader = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, lazyConnect: true });
    reader.on("error", () => { /* surfaced through the failing command below */ });
    try {
      await reader.connect();
      // One attempt only: replaying a prompt into a CLI is not idempotent.
      const job = await target.add(request.method, { ...request, callId }, { jobId: callId, attempts: 1, removeOnComplete: true, removeOnFail: 100 });
      let lastId = "0";
      let accepted = false;
      let deadline = Date.now() + ACCEPT_TIMEOUT_MS;
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          if (!accepted) {
            await job.remove().catch(() => undefined);
            throw unavailable("The orchestration worker did not pick up the runtime request. CLI runtimes run only there.");
          }
          throw unavailable("The orchestration worker stopped responding during the runtime request.");
        }
        const batch = await reader.xread("COUNT", 100, "BLOCK", Math.min(remaining, BLOCK_MS), "STREAMS", key, lastId);
        if (!batch) continue;
        for (const [, entries] of batch) {
          for (const [id, fields] of entries) {
            lastId = id;
            const raw = fields[fields.indexOf("m") + 1];
            const reply = JSON.parse(raw) as RuntimeCallReply;
            accepted = true;
            deadline = Date.now() + IDLE_TIMEOUT_MS;
            if (reply.t === "accepted" || reply.t === "alive") continue;
            yield reply;
            if (reply.t === "result" || reply.t === "error") return;
          }
        }
      }
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw unavailable("CLI runtime requests could not reach Redis.");
    } finally {
      reader.disconnect();
    }
  },
};

export async function closeRuntimeCallQueue(): Promise<void> {
  const current = queue;
  queue = null;
  await current?.close();
}
