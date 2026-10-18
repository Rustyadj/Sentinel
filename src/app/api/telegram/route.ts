import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/bots/api";
import { telegramStatus } from "@/lib/telegram/admin";
export async function GET() {
  try { return NextResponse.json(await telegramStatus()); }
  catch (error) { return errorResponse(error); }
}
