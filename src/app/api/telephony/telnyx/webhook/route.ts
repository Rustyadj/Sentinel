import { after, NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { loadTelnyxConfig, TelnyxConfigError } from "@/lib/telephony/telnyx/config";
import { parseTelnyxEvent } from "@/lib/telephony/telnyx/events";
import { handleTelnyxEvent } from "@/lib/telephony/telnyx/handler";
import { verifyTelnyxSignature } from "@/lib/telephony/telnyx/signature";

export const runtime = "nodejs";

/**
 * Telnyx webhook for SMS and Call Control events.
 *
 * Authenticated by Ed25519 signature, not by session, so it is excluded from
 * the page auth gate in src/proxy.ts. Telnyx expects a fast 2xx and redelivers
 * on timeout, so the agent turn runs in after() and events are deduplicated.
 */
export async function POST(req: NextRequest) {
  let config;
  try {
    config = loadTelnyxConfig();
  } catch (error) {
    if (error instanceof TelnyxConfigError) return NextResponse.json({ error: "Telnyx is not configured" }, { status: 503 });
    throw error;
  }

  const rawBody = await req.text();
  const verdict = verifyTelnyxSignature({
    rawBody,
    signature: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    publicKey: config.publicKey,
  });
  if (!verdict.ok) {
    logger.warn("telnyx.webhook_unauthorized", { reason: verdict.reason });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = parseTelnyxEvent(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Malformed event" }, { status: 400 });
  }

  after(() => handleTelnyxEvent(config, event));
  return NextResponse.json({ received: true });
}
