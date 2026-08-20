import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { verifyMobileToken } from "@/lib/mobile-auth";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new Error("Unauthorized");
  }

  const userById = await db.user.findUnique({
    where: { id: session.user.id },
  });
  if (userById?.email === session.user.email) return userById;

  return db.user.upsert({
    where: { email: session.user.email },
    update: { name: session.user.name ?? undefined },
    create: { email: session.user.email, name: session.user.name ?? undefined },
  });
}

/**
 * Same contract as requireUser(), extended for callers a browser cookie
 * can't reach — the mobile app authenticates with a bearer token
 * (see mobile-auth.ts) instead of a session cookie. A request carrying a
 * valid `Authorization: Bearer <token>` header is resolved against that
 * token; everything else falls back to the normal cookie session, so
 * web callers are unaffected.
 */
export async function requireApiUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const payload = verifyMobileToken(authorization.slice("Bearer ".length));
    if (!payload) throw new Error("Unauthorized");
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.email !== payload.email) throw new Error("Unauthorized");
    return user;
  }
  return requireUser();
}
