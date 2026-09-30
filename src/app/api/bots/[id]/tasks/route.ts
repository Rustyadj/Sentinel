import { NextResponse } from "next/server";
import { errorResponse, readBody, requireBotAccess } from "@/lib/bots/api";
import { botUsageToday, delegateToBot, listBotTasks } from "@/lib/bots/tasks";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "30");
    const [tasks, usageToday] = await Promise.all([listBotTasks(id, { userId: user.id, isAdmin: true }, limit), botUsageToday(id)]);
    return NextResponse.json({ tasks, usageToday });
  } catch (error) { return errorResponse(error); }
}

/** An admin delegating by hand, as themselves. Subject to the bot's allowed callers like any other caller. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const task = await delegateToBot(id, await readBody(request) as Parameters<typeof delegateToBot>[1], { kind: "user", userId: user.id });
    return NextResponse.json({ task }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
