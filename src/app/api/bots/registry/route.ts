import { NextResponse } from "next/server";
import { errorResponse, HttpError } from "@/lib/bots/api";
import { getControlPlaneUser } from "@/lib/agents/permissions";
import { listRegistryBots } from "@/lib/bots/registry";

/** Discovery for any workspace member: active bots that accept the signed-in user as a caller. */
export async function GET(request: Request) {
  try {
    const user = await getControlPlaneUser();
    if (!user) throw new HttpError("Unauthorized", 401);
    const params = new URL(request.url).searchParams;
    const bots = await listRegistryBots({
      userId: user.id, workspaceId: params.get("workspaceId") ?? undefined, query: params.get("query") ?? undefined,
      capability: params.get("capability") ?? undefined, callableBy: `user:${user.id}`,
    });
    return NextResponse.json({ bots });
  } catch (error) { return errorResponse(error); }
}
