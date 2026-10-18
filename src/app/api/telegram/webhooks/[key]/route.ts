import { NextResponse } from "next/server";
import { envSecret, TelegramError, validSecret } from "@/lib/telegram/policy";
import { receiveUpdate, resolveBinding } from "@/lib/telegram/service";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const binding = await resolveBinding((await params).key);
    if (!validSecret(request.headers.get("x-telegram-bot-api-secret-token"), envSecret(binding.webhookSecretEnvVar))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!request.body) throw new TelegramError("invalid_update");
    const reader = request.body.getReader(); const buffers: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 256_000) throw new TelegramError("update_too_large", 413);
        buffers.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(buffers).toString("utf8")); } catch { throw new TelegramError("invalid_json"); }
    const id = await receiveUpdate(binding, payload);
    return NextResponse.json({ accepted: true, id }, { status: 200 });
  } catch (error) {
    if (error instanceof TelegramError) return NextResponse.json({ error: error.code }, { status: error.status });
    // A DB outage must be non-2xx so Telegram retries. Never log raw messages or credentials.
    console.error(JSON.stringify({ event: "telegram.webhook.failed", code: "inbox_unavailable" }));
    return NextResponse.json({ error: "inbox_unavailable" }, { status: 503 });
  }
}
