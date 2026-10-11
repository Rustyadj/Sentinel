import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { countActiveCalls } from "@/lib/telephony/calls/service";
import { telephonyErrorResponse } from "@/lib/telephony/http";
import { loadTelnyxConfig, TelnyxConfigError } from "@/lib/telephony/telnyx/config";

export const runtime = "nodejs";

/** What the dialer needs to know: is the line configured for texting and calling, and how busy is it. Never returns secrets. */
export async function GET() {
  try {
    await requireUser();
    try {
      const config = loadTelnyxConfig();
      return NextResponse.json({
        configured: true,
        fromNumber: config.fromNumber,
        calling: Boolean(config.connectionId && config.mediaWsUrl && config.mediaTokenSecret),
        activeCalls: await countActiveCalls(),
        maxConcurrentCalls: config.maxConcurrentCalls,
      });
    } catch (error) {
      if (error instanceof TelnyxConfigError) return NextResponse.json({ configured: false, calling: false, reason: error.message });
      throw error;
    }
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}
