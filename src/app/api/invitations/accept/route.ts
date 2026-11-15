import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { acceptInvitation } from "@/lib/people/invitations";
import { peopleErrorResponse } from "@/lib/people/http";

/** Accepting as an account that already exists. New accounts accept through registration. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string") return NextResponse.json({ error: "token is required" }, { status: 400 });
    return NextResponse.json(await acceptInvitation(body.token, user));
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
