import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getAgentTrustProfile } from "@/lib/learning/trust";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agentId = new URL(req.url).searchParams.get("agentId")?.trim();
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  return NextResponse.json(await getAgentTrustProfile(agentId));
}
