import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody, requireBotAccess } from "@/lib/bots/api";
import { grantToolPermission, revokeToolPermission } from "@/lib/bots/service";

type Ctx = { params: Promise<{ id: string }> };

/** Set the permission for one server (toolName "*") or one tool. */
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const grant = await grantToolPermission(id, await readBody(request) as Parameters<typeof grantToolPermission>[1], user.id);
    return NextResponse.json({ grant });
  } catch (error) { return errorResponse(error); }
}

/** Remove a grant (back to no access): ?serverId=&toolName= (toolName defaults to "*"). */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const url = new URL(request.url);
    const serverId = url.searchParams.get("serverId");
    if (!serverId) throw new HttpError("serverId is required", 400);
    const removed = await revokeToolPermission(id, serverId, url.searchParams.get("toolName") ?? "*", user.id);
    return NextResponse.json({ removed });
  } catch (error) { return errorResponse(error); }
}
