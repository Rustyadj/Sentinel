import { describe, expect, it } from "vitest";
import {
  DockerSandbox,
  MockTestSandbox,
} from "@/lib/learning/sandbox";

const MAX_SANDBOX_OUTPUT_BYTES = 64 * 1024;

describe("release audit — sandbox security boundary", () => {
  it("rejects parent traversal and attempts to read environment files", async () => {
    const mock = new MockTestSandbox();
    const docker = new DockerSandbox("audit-image");

    expect((await mock.validate({ command: ["cat", "../.env"] })).valid).toBe(false);
    expect((await docker.validate({ command: ["cat", "/app/.env"] })).valid).toBe(false);
    expect((await docker.validate({ command: ["cat", "/run/secrets/api-key"] })).valid)
      .toBe(false);
  });

  it("refuses credential-shaped environment variables instead of injecting them", async () => {
    const result = await new MockTestSandbox().execute({
      command: ["true"],
      env: { DATABASE_URL: "postgresql://must-not-enter-sandbox" },
    });

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/environment|credential|DATABASE_URL/i);
  });

  it("bounds captured output so a candidate cannot exhaust worker memory", async () => {
    const result = await new MockTestSandbox().execute({
      command: ["node", "-e", "process.stdout.write('x'.repeat(200000))"],
      timeoutMs: 10_000,
    });

    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(MAX_SANDBOX_OUTPUT_BYTES);
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/output limit/i);
  });
});
