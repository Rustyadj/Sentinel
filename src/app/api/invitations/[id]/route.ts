import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { revokeInvitation } from "@/lib/people/invitations";
import { peopleErrorResponse } from "@/lib/people/http";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await revokeInvitation((await params).id, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
