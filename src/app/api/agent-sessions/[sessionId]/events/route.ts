import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse, SSE_HEADERS, sseEvent } from "@/lib/agents/runtime/api";
import { runtimeSessionStore } from "@/lib/agents/runtime/store";

const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.view);
    const url = new URL(request.url);
    let since = url.searchParams.get("since") ?? undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const deadline = Date.now() + 30_000;
        try {
          while (!request.signal.aborted && Date.now() < deadline) {
            const { events } = await runtimeSessionStore.logs(sessionId, since, 200);
            for (const event of events) {
              controller.enqueue(encoder.encode(sseEvent(event)));
              since = String(event.sequence);
            }
            const session = await runtimeSessionStore.get(sessionId);
            if (!session || (TERMINAL.has(session.status) && events.length === 0)) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) { return runtimeErrorResponse(error); }
}
