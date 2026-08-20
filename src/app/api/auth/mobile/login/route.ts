import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signMobileToken } from "@/lib/mobile-auth";
import { corsPreflightResponse, withMobileCors } from "@/lib/mobile-cors";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Credentials-only login for the mobile app, mirroring the web Credentials
 * provider in auth.ts exactly (same lookup, same bcrypt compare) so an
 * account behaves identically on both surfaces. Google/GitHub accounts have
 * no passwordHash and can't sign in here — there's no mobile OAuth flow yet,
 * which is a real gap, not a silent one.
 *
 * On success, issues a bearer token (see mobile-auth.ts) the app stores and
 * sends as `Authorization: Bearer <token>` on every subsequent request.
 */
export async function POST(request: NextRequest) {
  return withMobileCors(await handlePost(request));
}

async function handlePost(request: NextRequest): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = signMobileToken({ sub: user.id, email: user.email });
  return NextResponse.json({
    token,
    user: { id: user.id, email: user.email, name: user.name },
  });
}
