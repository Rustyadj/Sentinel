import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { MCP_SCOPES } from "@/lib/integrations/oauth";

const SAFE_CLIENT_ID = /^[a-z][a-z0-9_-]{2,63}$/;

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clients = await db.externalClient.findMany({
    where: { createdByUserId: user.id },
    select: { clientId: true, name: true, redirectUris: true, allowedScopes: true, enabled: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ clients });
}

export async function POST(request: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { clientId?: string; name?: string; redirectUri?: string; scopes?: string[] } | null;
  if (!body?.clientId || !body.name?.trim() || !body.redirectUri || !SAFE_CLIENT_ID.test(body.clientId)) {
    return NextResponse.json({ error: "clientId, name, and redirectUri are required; clientId must be lowercase safe text." }, { status: 400 });
  }
  let redirect: URL;
  try { redirect = new URL(body.redirectUri); } catch { return NextResponse.json({ error: "redirectUri must be an absolute URL." }, { status: 400 }); }
  if (redirect.protocol !== "https:" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "redirectUri must use HTTPS in production." }, { status: 400 });
  }
  const scopes = body.scopes?.length ? [...new Set(body.scopes)] : ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];
  if (scopes.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) {
    return NextResponse.json({ error: "Unsupported scope requested." }, { status: 400 });
  }
  const client = await db.externalClient.create({
    data: { clientId: body.clientId, name: body.name.trim(), redirectUris: [redirect.toString()], allowedScopes: scopes, createdByUserId: user.id },
    select: { clientId: true, name: true, redirectUris: true, allowedScopes: true, enabled: true },
  }).catch((error: { code?: string }) => error.code === "P2002" ? null : Promise.reject(error));
  if (!client) return NextResponse.json({ error: "A client with this clientId already exists." }, { status: 409 });
  return NextResponse.json({ client }, { status: 201 });
}
