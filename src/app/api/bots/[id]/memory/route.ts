import { NextResponse } from "next/server";
import { errorResponse, readBody, requireBotAccess } from "@/lib/bots/api";
import { updateMemoryPolicy } from "@/lib/bots/service";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    return NextResponse.json({ memoryPolicy: await updateMemoryPolicy(id, await readBody(request), user.id) });
  } catch (error) { return errorResponse(error); }
}
