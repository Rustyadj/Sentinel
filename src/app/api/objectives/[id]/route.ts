import { NextResponse } from "next/server";
import { getObjective } from "@/lib/objectives/service";
import { currentUserId, objectiveErrorResponse } from "../_shared";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    return NextResponse.json(await getObjective(userId, id));
  } catch (error) {
    return objectiveErrorResponse(error);
  }
}
