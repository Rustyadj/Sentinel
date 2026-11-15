import { NextResponse } from "next/server";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { InvitationError } from "./invitations";

/** One error shape for every people route: a message a person can act on, and the right status. */
export function peopleErrorResponse(error: unknown): Response {
  if (error instanceof InvitationError || error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && /cannot be|Ownership/.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error("[people api]", error);
  return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
}

/** Where invitation links point. AUTH_URL is the public origin behind the proxy. */
export function publicOrigin(request: Request): string {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export function invitationUrl(request: Request, token: string): string {
  return `${publicOrigin(request)}/auth/invite/${token}`;
}
