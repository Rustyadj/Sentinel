import { NextResponse } from "next/server";
import { AUTH_RATE_LIMITS, clientAddress, consumeAuthAttempt, tooManyAttempts } from "@/lib/auth/rate-limit";
import { describeInvitation } from "@/lib/people/invitations";
import { peopleErrorResponse } from "@/lib/people/http";

/**
 * What an invitation offers, for someone who is not signed in yet. Lives
 * under /api/auth because that prefix is outside the page sign-in gate.
 * Rate limited per address like registration: the token is 256 bits, but an
 * endpoint that answers "valid or not" should still not be free to hammer.
 */
export async function GET(req: Request) {
  if (!(await consumeAuthAttempt(AUTH_RATE_LIMITS.registerPerAddress, `invite:${clientAddress(req.headers)}`))) {
    return tooManyAttempts();
  }
  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    return NextResponse.json(await describeInvitation(token));
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
