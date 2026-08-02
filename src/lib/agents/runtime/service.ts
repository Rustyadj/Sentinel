import type { AgentRuntime as AgentRuntimeRow } from "@prisma/client";
import { db } from "@/lib/db";
import { ClaudeCodeRuntimeAdapter } from "./claude-code";
import { CodexRuntimeAdapter } from "./codex";
import { COMPATIBILITY_RUNTIMES, asRuntimeInstance, compatibilityRuntime } from "./config";
import { HttpAgentRuntimeAdapter } from "./http-adapter";
import { RuntimeError } from "./errors";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeKind,
  RuntimeCapabilities,
  RuntimeInstance,
  RuntimeView,
} from "./types";

function recordToView(row: AgentRuntimeRow): RuntimeView {
  const fallback = compatibilityRuntime(row.id) ?? compatibilityRuntime(row.agentId);
  const capabilities = (row.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
    ? row.capabilities
    : fallback?.capabilities ?? {}) as unknown as RuntimeCapabilities;
  const logPath = row.logPath ?? fallback?.logSource?.ref;
  return {
    id: row.id,
    agentId: row.agentId,
    kind: row.kind as AgentRuntimeKind,
    transport: row.transport as RuntimeInstance["transport"],
    ...(fallback?.endpoint || row.endpoint ? { endpoint: fallback?.endpoint ?? row.endpoint ?? undefined } : {}),
    ...(fallback?.containerName || row.containerName ? { containerName: fallback?.containerName ?? row.containerName ?? undefined } : {}),
    ...(row.serviceName ? { serviceName: row.serviceName } : {}),
    ...(fallback?.executable || row.executable ? { executable: fallback?.executable ?? row.executable ?? undefined } : {}),
    args: fallback?.args ?? row.defaultArgs,
    ...(fallback?.workingDirectoryRoot || row.workingDirectoryRoot ? { workingDirectoryRoot: fallback?.workingDirectoryRoot ?? row.workingDirectoryRoot ?? undefined } : {}),
    ...(row.configPath ? { configPath: row.configPath } : fallback?.configPath ? { configPath: fallback.configPath } : {}),
    ...(logPath ? { logSource: { kind: row.transport === "docker" && row.containerName ? "docker" : "file", ref: row.containerName ?? logPath } } : {}),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : fallback?.workspaceId ? { workspaceId: fallback.workspaceId } : {}),
    enabled: row.enabled,
    capabilities,
    sentinelControl: "partial",
    ...(fallback?.nativeUiUrl ? { nativeUiUrl: fallback.nativeUiUrl } : {}),
    ...(fallback?.model ? { model: fallback.model } : {}),
  };
}

export async function listRuntimeViews(): Promise<RuntimeView[]> {
  try {
    const rows = await db.agentRuntime.findMany({ where: { enabled: true }, orderBy: [{ kind: "asc" }, { agentId: "asc" }] });
    if (rows.length) return rows.map(recordToView);
  } catch {
    // During an incremental deploy the app can start before the additive
    // migration. Compatibility data keeps reads alive; mutations still require
    // persisted runtime/session rows and therefore fail closed.
  }
  return COMPATIBILITY_RUNTIMES.filter((runtime) => runtime.enabled);
}

export async function getRuntimeView(id: string): Promise<RuntimeView | null> {
  try {
    const row = await db.agentRuntime.findFirst({ where: { enabled: true, OR: [{ id }, { agentId: id }] } });
    if (row) return recordToView(row);
  } catch {
    // See incremental migration note in listRuntimeViews().
  }
  return compatibilityRuntime(id) ?? null;
}

export async function resolveRuntimeInstance(id: string): Promise<RuntimeInstance | null> {
  const view = await getRuntimeView(id);
  return view ? asRuntimeInstance(view) : null;
}

const adapters: Record<AgentRuntimeKind, AgentRuntimeAdapter> = {
  "claude-code": new ClaudeCodeRuntimeAdapter(resolveRuntimeInstance),
  codex: new CodexRuntimeAdapter(resolveRuntimeInstance),
  hermes: new HttpAgentRuntimeAdapter("hermes", resolveRuntimeInstance),
  openclaw: new HttpAgentRuntimeAdapter("openclaw", resolveRuntimeInstance),
};

export function getRuntimeAdapter(kind: AgentRuntimeKind): AgentRuntimeAdapter {
  const adapter = adapters[kind];
  if (!adapter) throw new RuntimeError("Runtime adapter not found", "runtime_not_found", 404);
  return adapter;
}

export async function getAdapterForRuntime(id: string) {
  const runtime = await getRuntimeView(id);
  if (!runtime) throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
  return { runtime, adapter: getRuntimeAdapter(runtime.kind) };
}

export function setRuntimeAdapterForTests(kind: AgentRuntimeKind, adapter: AgentRuntimeAdapter) {
  adapters[kind] = adapter;
}
