import { NextResponse } from "next/server";
import { errorResponse, readBody, requiredString, requireBotAccess } from "@/lib/bots/api";
import { delegateToBot } from "@/lib/bots/tasks";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Run the bot on a prompt as a real task, before or after activation. It goes
 * through the same queue, worker, tool policy and memory policy as a delegated
 * task; the response is the task, which the client polls for events.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const body = await readBody(request);
    const task = await delegateToBot(id, {
      task: requiredString(body, "prompt"),
      modelRole: (typeof body.modelRole === "string" ? body.modelRole : "primary") as "primary",
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    }, { kind: "user", userId: user.id }, { mode: "test" });
    return NextResponse.json({ task }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
