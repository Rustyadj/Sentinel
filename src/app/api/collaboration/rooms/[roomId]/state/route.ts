import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { collaborationErrorResponse, requireRoomAccess } from "@/lib/orchestration/access";
import { getRoomSnapshot } from "@/lib/orchestration/room-state";

type Context = { params: Promise<{ roomId: string }> };

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const { roomId } = await params;
    await requireRoomAccess(roomId, user.id);
    return NextResponse.json(await getRoomSnapshot(roomId));
  } catch (error) {
    return collaborationErrorResponse(error);
  }
}
