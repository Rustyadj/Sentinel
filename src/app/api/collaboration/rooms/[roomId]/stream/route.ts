import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { requireRoomAccess } from "@/lib/orchestration/access";
import type { NextRequest } from "next/server";

// Collaboration Room live event stream (SSE). Same honest boundary as
// src/app/api/neural/stream/route.ts: this tails collaboration_events by
// polling for rows newer than the last sequence sent — there is no
// Postgres LISTEN/NOTIFY wired up in this repo.

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const POLL_MS = 1500;

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

type Context = { params: Promise<{ roomId: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  const { roomId } = await params;
  let user;
  try {
    user = await requireUser();
    await requireRoomAccess(roomId, user.id);
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let lastSequence = Number(searchParams.get("after") ?? 0) || 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(sse("ready", { at: new Date().toISOString(), after: lastSequence }));

      const tick = async () => {
        if (closed) return;
        try {
          const events = await db.collaborationEvent.findMany({
            where: { chatRoomId: roomId, sequence: { gt: lastSequence } },
            orderBy: { sequence: "asc" },
            take: 100,
          });
          if (events.length > 0) {
            lastSequence = events[events.length - 1].sequence;
            for (const event of events) {
              ctrl.enqueue(
                sse("collaboration-event", {
                  sequence: event.sequence,
                  type: event.type,
                  payload: event.payload,
                  occurredAt: event.occurredAt,
                }),
              );
            }
          } else {
            ctrl.enqueue(sse("heartbeat", { at: Date.now() }));
          }
        } catch {
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
          // already closed
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
