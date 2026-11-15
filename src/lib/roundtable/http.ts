import { NextResponse } from "next/server";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { RoundtableError } from "./engine";

export function roundtableErrorResponse(error: unknown): Response {
  if (error instanceof RoundtableError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof WorkspaceAccessError) {
    // Missing agents.runtime.execute, said in terms of what the person was trying to do.
    const message = error.status === 403 ? "Your role does not allow running agents. An admin can make you an operator." : error.message;
    return NextResponse.json({ error: message }, { status: error.status });
  }
  if (error instanceof RuntimeError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  console.error("[roundtable api]", error);
  return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
}
