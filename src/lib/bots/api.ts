// Shared plumbing for the /api/bots routes: who may call, and how errors map to
// HTTP. Management is workspace owner/admin only; members can use the registry.

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { canEditConfig, getAccessibleWorkspaceIds, getControlPlaneUser, getWorkspaceControlPlaneUser, type AuthorizedUser } from "@/lib/agents/permissions";
import { MemoryScopeError } from "@/lib/knowledge/memory-scope";
import { McpRegistrationError } from "./catalog";
import { BotConfigError } from "./models";
import { BotTaskError } from "./tasks";

export class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "HttpError"; }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError || error instanceof BotConfigError || error instanceof BotTaskError || error instanceof McpRegistrationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") }, { status: 400 });
  }
  if (error instanceof MemoryScopeError) return NextResponse.json({ error: error.message }, { status: 403 });
  // Anything else is unexpected: log it, and do not leak internals to the client.
  console.error("[bots-api]", error);
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}

/** Owner/admin of the workspace. 401 when signed out or not a member, 403 for a plain member. */
export async function requireBotAdmin(workspaceId: string): Promise<AuthorizedUser> {
  const user = await getWorkspaceControlPlaneUser(workspaceId);
  if (!user) throw new HttpError("Unauthorized", 401);
  if (!canEditConfig(user.role)) throw new HttpError("Forbidden: requires owner or admin", 403);
  return user;
}

/** Load a bot and require admin over its workspace. A missing bot and an inaccessible one both read as 404 to non-members. */
export async function requireBotAccess(botId: string) {
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new HttpError("Bot not found", 404);
  const user = await requireBotAdmin(bot.workspaceId).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 401) throw new HttpError("Bot not found", 404);
    throw error;
  });
  return { bot, user };
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Request body must be a JSON object", 400);
  return body as Record<string, unknown>;
}

export const requiredString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(`${key} is required`, 400);
  return value.trim();
};

/** Workspaces the current user administers, for list screens. */
export async function adminWorkspaceIds(requested?: string | null): Promise<{ user: AuthorizedUser; workspaceIds: string[] }> {
  if (requested) return { user: await requireBotAdmin(requested), workspaceIds: [requested] };
  const user = await getControlPlaneUser();
  if (!user) throw new HttpError("Unauthorized", 401);
  const admin: string[] = [];
  for (const id of await getAccessibleWorkspaceIds(user.id)) {
    const scoped = await getWorkspaceControlPlaneUser(id);
    if (scoped && canEditConfig(scoped.role)) admin.push(id);
  }
  return { user, workspaceIds: admin };
}
