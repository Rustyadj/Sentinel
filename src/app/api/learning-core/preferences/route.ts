import { NextResponse } from "next/server";
import { learnPreference, listPreferences } from "@/lib/learning-core/preferences";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const preferences = await listPreferences({
    userId: searchParams.get("userId") ?? undefined,
    minConfidence: searchParams.get("minConfidence") ? Number(searchParams.get("minConfidence")) : undefined,
  });
  return NextResponse.json(preferences);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.key || body.value === undefined) {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }
  const preference = await learnPreference(body);
  return NextResponse.json(preference);
}
