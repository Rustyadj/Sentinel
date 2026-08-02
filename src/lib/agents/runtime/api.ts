import { RuntimeError } from "./errors";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";
import type { RuntimeEvent, RuntimeView } from "./types";

export function runtimeErrorResponse(error: unknown) {
  if (error instanceof RuntimeError || error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message, code: error instanceof RuntimeError ? error.code : "access_denied" }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal runtime error";
  return Response.json({ error: message, code: "runtime_error" }, { status: 500 });
}

export function parseLimit(raw: string | null, fallback = 50, max = 200) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), max) : fallback;
}

export async function readJsonObject(request: Request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("JSON object body is required", "invalid_body", 400);
  }
  return value as Record<string, unknown>;
}

export function sseEvent(event: RuntimeEvent | { type: "error"; data: Record<string, unknown> }) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function publicRuntimeView(runtime: RuntimeView) {
  return {
    id: runtime.id,
    agentId: runtime.agentId,
    kind: runtime.kind,
    transport: runtime.transport,
    endpoint: runtime.endpoint,
    containerName: runtime.containerName,
    serviceName: runtime.serviceName,
    workingDirectoryRoot: runtime.workingDirectoryRoot,
    workspaceId: runtime.workspaceId,
    enabled: runtime.enabled,
    capabilities: runtime.capabilities,
    sentinelControl: runtime.sentinelControl,
    nativeUiUrl: runtime.nativeUiUrl,
    model: runtime.model,
  };
}
