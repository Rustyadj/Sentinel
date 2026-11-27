import { setTimeout as delay } from "node:timers/promises";
import { SSE_HEADERS } from "@/lib/agents/runtime/api";
import { db } from "@/lib/db";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return Response.json({ error: "workspaceId is required" }, { status: 400 });
  try {
    await requireWorkspacePermission(workspaceId, "task.read");
  } catch (error) {
    return accessErrorResponse(error);
  }

  const stop = new AbortController();
  const signal = AbortSignal.any([request.signal, stop.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const deadline = Date.now() + 30_000;
      let lastRevision = request.headers.get("Last-Event-ID");
      try {
        while (!signal.aborted && Date.now() < deadline) {
          const latest = await db.objectiveEvent.findFirst({
            where: { objective: { workspaceId } },
            select: { id: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (signal.aborted) break;
          const revision = latest?.id ?? "empty";
          if (revision !== lastRevision) {
            controller.enqueue(encoder.encode(`id: ${revision}\nevent: activity\ndata: {}\n\n`));
            lastRevision = revision;
          } else {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
          await delay(2_000, undefined, { signal });
        }
      } catch (error) {
        if (!signal.aborted) console.error("[workforce] Could not tail objective activity.", error);
      } finally {
        if (!stop.signal.aborted) controller.close();
      }
    },
    cancel() {
      stop.abort();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
