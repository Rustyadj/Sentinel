import { installedEffortOptions, type EffortLevel } from "@/lib/agents/model-policy";
import { RuntimeError } from "./errors";
import {
  HEARTBEAT_INTERVAL_MS, isCliRuntimeKind, isRuntimeCallMethod, serializeRuntimeError,
  type RuntimeCallPayload, type RuntimeCallReply,
} from "./remote-execution";
import type { AgentRuntimeAdapter, AgentRuntimeKind, RuntimeInstance } from "./types";

/**
 * orchestration-worker's side of remote-execution.ts: run one CLI adapter call
 * against the local adapter and publish its replies.
 *
 * Requests arrive through Redis, which other containers can reach, so nothing
 * from the payload is passed through blindly: runtime instances are
 * re-resolved from this process's registry by id (the request never chooses an
 * executable or arguments), and input objects are rebuilt from known fields.
 * The adapters keep their own checks — session ownership, prompt validity,
 * working-directory containment — exactly as they apply in-process.
 */
export interface ExecutionHostDependencies {
  adapterFor(kind: AgentRuntimeKind): AgentRuntimeAdapter;
  resolveRuntime(id: string): Promise<RuntimeInstance | null>;
}

const EFFORTS = new Set<EffortLevel>(["none", "low", "medium", "high", "xhigh", "max"]);
const MAX_EFFORT_MODELS = 32;

function invalid(field: string): never {
  throw new RuntimeError(`Invalid runtime call: ${field}.`, "invalid_runtime_call", 400);
}

function str(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) invalid(field);
  return value;
}

function optStr(value: unknown, field: string, max = 4_096): string | undefined {
  return value === undefined || value === null ? undefined : str(value, field, max);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function modelOverride(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const raw = record(value, "modelOverride");
  const effort = raw.effort;
  if (effort !== undefined && effort !== null && !EFFORTS.has(effort as EffortLevel)) invalid("modelOverride.effort");
  if (typeof raw.authorized !== "boolean") invalid("modelOverride.authorized");
  return { model: str(raw.model, "modelOverride.model"), effort: (effort ?? null) as EffortLevel | null, authorized: raw.authorized };
}

async function runtimeFor(deps: ExecutionHostDependencies, kind: AgentRuntimeKind, id: unknown): Promise<RuntimeInstance> {
  const runtime = await deps.resolveRuntime(str(id, "runtimeId"));
  if (!runtime || runtime.kind !== kind) throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
  return runtime;
}

export async function executeRuntimeCall(
  payload: RuntimeCallPayload,
  publish: (reply: RuntimeCallReply) => Promise<void>,
  deps: ExecutionHostDependencies,
): Promise<void> {
  await publish({ t: "accepted" });
  const heartbeat = setInterval(() => { void publish({ t: "alive" }).catch(() => undefined); }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  try {
    const { kind, method } = payload;
    if (!isCliRuntimeKind(kind)) invalid("kind");
    if (!isRuntimeCallMethod(method)) invalid("method");
    const args = Array.isArray(payload.args) ? payload.args : invalid("args");
    const adapter = deps.adapterFor(kind);
    let value: unknown = null;
    switch (method) {
      case "discover":
        value = await adapter.discover();
        break;
      case "health":
        value = await adapter.health(await runtimeFor(deps, kind, args[0]));
        break;
      case "readiness":
        value = await adapter.readiness(await runtimeFor(deps, kind, args[0]));
        break;
      case "startSession": {
        const input = record(args[0], "input");
        value = await adapter.startSession({
          runtimeId: str(input.runtimeId, "runtimeId"),
          userId: str(input.userId, "userId"),
          workspaceId: optStr(input.workspaceId, "workspaceId", 200),
          projectId: optStr(input.projectId, "projectId", 200),
          workingDirectory: optStr(input.workingDirectory, "workingDirectory"),
          initialPrompt: optStr(input.initialPrompt, "initialPrompt", 100_000),
          modelOverride: modelOverride(input.modelOverride),
          ...(input.toolGate === "bot" ? { toolGate: "bot" as const } : {}),
        });
        break;
      }
      case "resumeSession": {
        const input = record(args[0], "input");
        value = await adapter.resumeSession({
          runtimeId: str(input.runtimeId, "runtimeId"),
          externalSessionId: str(input.externalSessionId, "externalSessionId"),
          userId: str(input.userId, "userId"),
        });
        break;
      }
      case "send": {
        const input = record(args[0], "input");
        const events = adapter.send({
          sessionId: str(input.sessionId, "sessionId"),
          prompt: typeof input.prompt === "string" ? input.prompt : invalid("prompt"),
          userId: str(input.userId, "userId"),
        });
        for await (const event of events) await publish({ t: "event", event });
        break;
      }
      case "cancel":
        value = await adapter.cancel(str(args[0], "sessionId"));
        break;
      case "effortOptions": {
        const runtime = await runtimeFor(deps, kind, args[0]);
        const models = args[1];
        if (!Array.isArray(models) || models.length > MAX_EFFORT_MODELS) invalid("models");
        const entries = await Promise.all(models.map(async (model) => [str(model, "model"), await installedEffortOptions(runtime, model as string)] as const));
        value = Object.fromEntries(entries);
        break;
      }
    }
    await publish({ t: "result", value });
  } catch (error) {
    await publish({ t: "error", error: serializeRuntimeError(error) });
  } finally {
    clearInterval(heartbeat);
  }
}
