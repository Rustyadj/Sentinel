import { NextRequest, NextResponse } from "next/server";
import { extractCandidates } from "@/lib/knowledge/extraction";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    messages: Array<{ role: string; content: string }>;
    roomId?: string;
    projectId?: string;
  };
  const anthropicKey =
    req.headers.get("x-anthropic-key") ?? process.env.ANTHROPIC_API_KEY ?? undefined;

  try {
    const candidates = await extractCandidates({
      messages: body.messages,
      roomId: body.roomId,
      projectId: body.projectId,
      anthropicKey,
    });
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ candidates: [] });
  }
}
