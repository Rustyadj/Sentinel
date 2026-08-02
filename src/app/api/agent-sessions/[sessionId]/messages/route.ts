import { writeAuditLog } from "@/lib/workspaces/audit";
import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { readJsonObject, runtimeErrorResponse, SSE_HEADERS, sseEvent } from "@/lib/agents/runtime/api";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { runtimeSessionStore } from "@/lib/agents/runtime/store";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const { user, runtime, session } = await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.execute);
    const body = await readJsonObject(request);
    if (typeof body.prompt !== "string") throw new RuntimeError("prompt is required", "invalid_body", 400);
    await runtimeSessionStore.update(sessionId, {
      metadata: { ...session.metadata, lastTask: body.prompt.slice(0, 160) },
    });
    await runtimeSessionStore.append(sessionId, "status", {
      phase: "task_submitted",
      prompt: body.prompt,
    });
    await writeAuditLog({
      workspaceId: session.workspaceId, projectId: session.projectId, userId: user.id,
      action: "agent_runtime.task_sent", entityType: "AgentSession", entityId: sessionId,
      details: { runtimeId: runtime.id, promptLength: body.prompt.length },
    });
    const adapter = getRuntimeAdapter(runtime.kind);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of adapter.send({ sessionId, prompt: body.prompt as string, userId: user.id })) {
            controller.enqueue(encoder.encode(sseEvent(event)));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(sseEvent({ type: "error", data: { message: error instanceof Error ? error.message : "Runtime stream failed" } })));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) { return runtimeErrorResponse(error); }
}
