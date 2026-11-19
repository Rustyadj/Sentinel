import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { ObjectiveError } from "@/lib/objectives/service";

export async function currentUserId(): Promise<string | null> {
  return requireUser().then((user) => user.id).catch(() => null);
}

export function objectiveErrorResponse(error: unknown) {
  if (error instanceof ObjectiveError) return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
  console.error("[objectives]", error);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
