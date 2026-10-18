import { __test__ } from "@/lib/agents/runtime/hermes";
import { describe, expect, it, vi } from "vitest";
import { downloadFile, telegramCall } from "@/lib/telegram/client";
import { verifyTelegramRuntimeGate } from "@/lib/telegram/gate";
import type { HermesWebSocketClient } from "@/lib/agents/runtime/transports/hermes-websocket";

describe("Telegram API transport and trusted gate", () => {
  it("denies replayed approval request IDs instead of issuing another one-use response", async () => {
    const authorize = vi.fn().mockResolvedValue({ allow: true, reason: "test" });
    const handler = __test__.botServerRequestHandler(authorize);
    const request = { id: "srq-1", method: "approval", params: { pattern_key: "plugin_rule:sentinel-bot:call-1", command: "<web_search> (plugin approval rule)", request_id: "r-1" } };
    expect(await handler(request)).toEqual({ result: { choice: "once" } });
    expect(await handler(request)).toEqual({ result: { choice: "deny" } });
    expect(authorize).toHaveBeenCalledTimes(1);
  });
  it("does not expose a bot token or token-bearing fetch error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("https://api.telegram.org/botsecret/sendMessage"));
    await expect(telegramCall("secret", "sendMessage", {}, fetcher)).rejects.toMatchObject({ code: "telegram_transport_unknown", ambiguous: true, message: "telegram_transport_unknown" });
  });
  it("honors Telegram retry_after without treating a 429 as an ambiguous send", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: false, error_code: 429, description: "secret", parameters: { retry_after: 19 } }, { status: 429 }));
    await expect(telegramCall("secret", "sendMessage", {}, fetcher)).rejects.toMatchObject({ retryAfter: 19, ambiguous: false });
  });
  it("rejects Telegram file path traversal before fetching bytes", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, result: { file_path: "../secret" } }));
    await expect(downloadFile("secret", "file", fetcher)).rejects.toMatchObject({ code: "attachment_not_supported" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized downloads even when a server omits content-length", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "documents/file" } })).mockResolvedValueOnce(new Response(new Uint8Array(20_000_001)));
    await expect(downloadFile("secret", "file", fetcher)).rejects.toMatchObject({ code: "attachment_too_large" });
  });
  it("requires an authenticated plugin proof matching the exact nonce, source, and profile", async () => {
    const call = vi.fn(async (_method: string, p: Record<string, unknown>) => ({ type: "plugin", output: JSON.stringify({ nonce: p.arg, version: 1, source: "sentinel-telegram:c123456789012345678901234", profile: "sentinel-lisa", ready: true }) }));
    await expect(verifyTelegramRuntimeGate({ call } as unknown as HermesWebSocketClient, "session", "sentinel-lisa", "sentinel-telegram:c123456789012345678901234")).resolves.toBeUndefined();
    await expect(verifyTelegramRuntimeGate({ call } as unknown as HermesWebSocketClient, "session", "sentinel-nathan2", "sentinel-telegram:c123456789012345678901234")).rejects.toThrow(/not ready/);
  });
  it("refuses missing, false, or forged capability claims", async () => {
    for (const result of [{ type: "plugin", output: "{}" }, { type: "quick", output: "claimed-ready" }, { type: "plugin", output: "not-json" }]) {
      const client = { call: vi.fn().mockResolvedValue(result) };
      await expect(verifyTelegramRuntimeGate(client as unknown as HermesWebSocketClient, "session", "profile", "source")).rejects.toThrow();
    }
  });
});
