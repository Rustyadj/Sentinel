import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/current-user";
import { corsPreflightResponse, withMobileCors } from "@/lib/mobile-cors";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Signs the caller out of every mobile device: all bearer tokens issued up to
 * now stop working (see isMobileTokenRevoked). Tokens are stateless, so this
 * is per-user, not per-device. Accepts either a mobile bearer token (e.g. from
 * a device being retired) or the web session cookie (e.g. after losing the
 * phone). Web sessions are unaffected.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireApiUser(request)).id;
  } catch {
    return withMobileCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }
  await db.user.update({ where: { id: userId }, data: { mobileTokensRevokedAt: new Date() } });
  return withMobileCors(NextResponse.json({ ok: true }));
}
