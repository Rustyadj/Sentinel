import { NextResponse } from "next/server";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { OutsideAgentError } from "./a2a/http";
import { ProjectAgentError } from "./project-agents";

/** One error shape for the project-agent routes: a message a person can act on, and the right status. */
export function projectAgentErrorResponse(error: unknown): Response {
  if (error instanceof ProjectAgentError || error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof OutsideAgentError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error("[project agents api]", error);
  return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
}
