import { NextResponse } from "next/server";
import { errorResponse, requireBotAccess } from "@/lib/bots/api";
import { listBotVersions } from "@/lib/bots/versions";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireBotAccess(id);
    return NextResponse.json({ versions: await listBotVersions(id) });
  } catch (error) { return errorResponse(error); }
}
