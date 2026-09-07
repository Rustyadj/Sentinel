import { describe, expect, it } from "vitest";
import { redactPayload } from "./redaction";

describe("redactPayload", () => {
  it("redacts secret-shaped object keys", () => {
    const { payload, redactedKeys } = redactPayload({ apiKey: "sk-live-abcdefghijklmnop", note: "fine" });
    expect(payload.apiKey).toBe("[REDACTED]");
    expect(payload.note).toBe("fine");
    expect(redactedKeys).toContain("apiKey");
  });

  it("redacts a .env-style secret assignment embedded in free-form stdout text", () => {
    const stdout = [
      "$ cat .env",
      "DATABASE_URL=postgres://user:pass@host/db",
      'API_KEY="sk-live-abcdefghijklmnop"',
      "SECRET_TOKEN=mysupersecretvalue123",
      "PORT=3000",
    ].join("\n");
    const { payload } = redactPayload({ output: stdout });
    const output = payload.output as string;
    expect(output).not.toContain("mysupersecretvalue123");
    expect(output).not.toContain("sk-live-abcdefghijklmnop");
    expect(output).toContain("PORT=3000");
    expect(output).toContain("API_KEY=");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts bearer tokens and PEM private key blocks in free text", () => {
    const text = [
      "Authorization: Bearer abc123.def456-ghi789",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIBOgIBAAJBAK...",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const { payload } = redactPayload({ log: text });
    const log = payload.log as string;
    expect(log).not.toContain("abc123.def456-ghi789");
    expect(log).not.toContain("MIIBOgIBAAJBAK");
    expect(log).toContain("[REDACTED");
  });

  it("leaves ordinary code, hashes, and UUIDs untouched", () => {
    const text = [
      "const total = price * quantity;",
      "commit 4f2c9a1e8b3d7f0a1c2e3d4b5a6f7c8d9e0f1a2b",
      "id: 550e8400-e29b-41d4-a716-446655440000",
    ].join("\n");
    const { payload, redactedKeys } = redactPayload({ log: text });
    expect(payload.log).toBe(text);
    expect(redactedKeys).toHaveLength(0);
  });
});
