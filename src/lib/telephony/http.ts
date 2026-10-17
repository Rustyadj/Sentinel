import { NextResponse } from "next/server";
import { TelnyxApiError } from "./telnyx/client";
import { TelnyxConfigError } from "./telnyx/config";
import { CallPolicyError } from "./calls/policy";

const POLICY_STATUS: Record<CallPolicyError["code"], number> = {
  invalid_number: 422,
  destination_blocked: 403,
  rate_limited: 429,
  busy: 503,
  duplicate: 409,
  unavailable: 503,
};

/** Maps telephony failures onto HTTP; anything unexpected is rethrown for Next to log as a 500. */
export function telephonyErrorResponse(error: unknown): NextResponse {
  if (error instanceof CallPolicyError) return NextResponse.json({ error: error.message, code: error.code }, { status: POLICY_STATUS[error.code] });
  if (error instanceof TelnyxConfigError) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof TelnyxApiError) return NextResponse.json({ error: "The phone carrier rejected the request." }, { status: 502 });
  if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  throw error;
}
