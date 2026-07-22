import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { accessErrorResponse, requireProjectPermission } from "@/lib/workspaces/authorization";
import type { NextRequest } from "next/server";

// Sentinel Neural Engine — Phase D: live event stream (SSE)
//
// Streams KnowledgeEvent rows (the append-only log emitted across Phases A-C:
// experience.started, learning.proposed, edge.strengthened, etc.) to the
// Neural Lens client so the graph can merge updates incrementally instead of
// polling. Honest boundary: this tails the DB by polling for rows newer than
// the last id it sent (there is no Postgres LISTEN/NOTIFY wired up in this
// repo). Real streaming semantics for the client; DB-poll under the hood.

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const POLL_MS = 1500;

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  if (projectId) {
    try {
      await requireProjectPermission(projectId, "project.read");
    } catch (error) {
      return accessErrorResponse(error);
    }
  }

  let lastCreatedAt = new Date();
  let closed = false;

  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(sse("ready", { at: new Date().toISOString() }));

      const tick = async () => {
        if (closed) return;
        try {
          const events = await db.knowledgeEvent.findMany({
            where: {
              createdAt: { gt: lastCreatedAt },
              ...(projectId ? { projectId } : { userId: user.id }),
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          });
          if (events.length > 0) {
            lastCreatedAt = events[events.length - 1].createdAt;
            for (const e of events) {
              ctrl.enqueue(
                sse("knowledge-event", {
                  id: e.id,
                  type: e.type,
                  payload: e.payload,
                  projectId: e.projectId,
                  createdAt: e.createdAt,
                }),
              );
            }
          } else {
            // Heartbeat keeps proxies from closing an idle stream.
            ctrl.enqueue(sse("heartbeat", { at: Date.now() }));
          }
        } catch {
          // DB may be unavailable — keep the stream alive, try again next tick.
          if (!closed) ctrl.enqueue(sse("heartbeat", { at: Date.now() }));
        }
      };

      const interval = setInterval(() => void tick(), POLL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
