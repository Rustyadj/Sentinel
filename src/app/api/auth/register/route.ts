import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { normalizeEmail } from "@/lib/auth/email";
import { db } from "@/lib/db";
import { findEmailIdentities } from "@/lib/auth/identity";
import { AUTH_RATE_LIMITS, clientAddress, consumeAuthAttempt, tooManyAttempts } from "@/lib/auth/rate-limit";
import { isSignupAllowed, SIGNUP_CLOSED_MESSAGE } from "@/lib/auth/signup-policy";
import { acceptInvitation, findOpenInvitation, invitationAdmits } from "@/lib/people/invitations";
import { peopleErrorResponse } from "@/lib/people/http";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt only hashes the first 72 bytes; a longer limit would silently truncate.
const MAX_PASSWORD_BYTES = 72;

export async function POST(req: Request) {
  if (!(await consumeAuthAttempt(AUTH_RATE_LIMITS.registerPerAddress, clientAddress(req.headers)))) {
    return tooManyAttempts();
  }

  let body: { email?: unknown; password?: unknown; name?: unknown; inviteToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Stored canonically so the account can be found again regardless of how
  // the address is typed, here or by a social provider.
  const email = normalizeEmail(body.email);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }

  if (body.password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (Buffer.byteLength(body.password, "utf8") > MAX_PASSWORD_BYTES) {
    return NextResponse.json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` }, { status: 400 });
  }

  // An invitation is the one thing besides the allowlist that admits a new
  // account, and the signup policy is where that is decided. Looking the
  // invitation up first is only so a bad link gets a useful message (expired,
  // already used, issued to someone else) instead of "by invitation only".
  const inviteToken = typeof body.inviteToken === "string" && body.inviteToken ? body.inviteToken : null;
  let invitation: Awaited<ReturnType<typeof findOpenInvitation>> | null = null;
  if (inviteToken) {
    try {
      invitation = await findOpenInvitation(inviteToken);
    } catch (error) {
      return peopleErrorResponse(error);
    }
    if (!invitationAdmits(invitation, email)) {
      return NextResponse.json({ error: "This invitation was issued to a different email address." }, { status: 403 });
    }
  }
  if (!(await isSignupAllowed(email, inviteToken))) {
    return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
  }

  const existing = await findEmailIdentities(email);
  if (existing.length > 0) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : email.split("@")[0];

  const user = await db.user.create({
    // Someone invited to a project is a guest: they reach that project and
    // are not enrolled in the shared workspaces. Joining the team makes a member.
    data: { email, name, passwordHash, accessScope: invitation?.scope === "project" ? "guest" : "member" },
    select: { id: true, email: true, name: true },
  });

  if (inviteToken) {
    try {
      await acceptInvitation(inviteToken, user);
    } catch (error) {
      // Lost a race for the link. The account was admitted only by that
      // invitation, so it does not outlive it.
      await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
      return peopleErrorResponse(error);
    }
  }

  return NextResponse.json(user, { status: 201 });
}
