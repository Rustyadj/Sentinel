import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handled = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/telephony/telnyx/handler", () => ({ handleTelnyxEvent: handled }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

import { POST } from "./route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const body = JSON.stringify({ data: { id: "e1", event_type: "message.received", payload: { from: { phone_number: "+15551230000" }, text: "hi" } } });

function request(over: { body?: string; signature?: string; timestamp?: string } = {}) {
  const timestamp = over.timestamp ?? String(Math.floor(Date.now() / 1000));
  const payload = over.body ?? body;
  const signature = over.signature ?? sign(null, Buffer.from(`${timestamp}|${payload}`), privateKey).toString("base64");
  return new NextRequest("https://sentinel.test/api/telephony/telnyx/webhook", {
    method: "POST", body: payload,
    headers: { "telnyx-signature-ed25519": signature, "telnyx-timestamp": timestamp },
  });
}

describe("POST /api/telephony/telnyx/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("TELNYX_API_KEY", "k");
    vi.stubEnv("TELNYX_PUBLIC_KEY", rawKey);
    vi.stubEnv("TELNYX_FROM_NUMBER", "+15550001111");
    vi.stubEnv("TELNYX_OWNER_USER_ID", "owner");
    handled.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a correctly signed event and hands it off", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(handled).toHaveBeenCalledOnce();
  });

  it("rejects a bad signature, a tampered body and a replayed old timestamp", async () => {
    expect((await POST(request({ signature: Buffer.alloc(64).toString("base64") }))).status).toBe(401);
    const good = request();
    const tampered = new NextRequest(good.url, { method: "POST", body: body.replace("hi", "rm -rf"), headers: good.headers });
    expect((await POST(tampered)).status).toBe(401);
    expect((await POST(request({ timestamp: String(Math.floor(Date.now() / 1000) - 3_600) }))).status).toBe(401);
    expect(handled).not.toHaveBeenCalled();
  });

  it("returns 503 when Telnyx is not configured and 400 for a signed but malformed envelope", async () => {
    vi.stubEnv("TELNYX_API_KEY", "");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("TELNYX_API_KEY", "k");
    expect((await POST(request({ body: '{"nope":true}' }))).status).toBe(400);
  });
});
