import { describe, expect, it } from "vitest";
import { UnavailableSandbox, MockTestSandbox } from "@/lib/learning/sandbox";

describe("sandbox — fail-closed policy", () => {
  it("UnavailableSandbox refuses to validate anything", async () => {
    const sandbox = new UnavailableSandbox();
    const result = await sandbox.validate({ command: ["echo", "hi"] });
    expect(result.valid).toBe(false);
  });

  it("UnavailableSandbox refuses to execute — status is 'unavailable', never 'completed'", async () => {
    const sandbox = new UnavailableSandbox();
    const result = await sandbox.execute({ command: ["echo", "hi"] });
    expect(result.status).toBe("unavailable");
    expect(result.exitCode).toBeNull();
  });

  it("UnavailableSandbox reports itself as production-safe (refusing to run is the safe behavior)", () => {
    expect(new UnavailableSandbox().isProductionSafe).toBe(true);
  });
});

describe("sandbox — command validation (escape-attempt rejection)", () => {
  const sandbox = new MockTestSandbox();

  it("rejects network tools", async () => {
    expect((await sandbox.validate({ command: ["curl", "http://evil.example"] })).valid).toBe(false);
    expect((await sandbox.validate({ command: ["wget", "http://evil.example"] })).valid).toBe(false);
  });

  it("rejects shell chaining / command injection attempts", async () => {
    expect((await sandbox.validate({ command: ["echo", "hi; rm -rf /"] })).valid).toBe(false);
    expect((await sandbox.validate({ command: ["echo", "hi && curl evil.com"] })).valid).toBe(false);
    expect((await sandbox.validate({ command: ["echo", "$(whoami)"] })).valid).toBe(false);
  });

  it("rejects privilege escalation attempts", async () => {
    expect((await sandbox.validate({ command: ["sudo", "reboot"] })).valid).toBe(false);
    expect((await sandbox.validate({ command: ["chmod", "777", "/"] })).valid).toBe(false);
  });

  it("rejects an empty command", async () => {
    expect((await sandbox.validate({ command: [] })).valid).toBe(false);
  });

  it("accepts a benign command", async () => {
    expect((await sandbox.validate({ command: ["echo", "hello"] })).valid).toBe(true);
  });

  it("is explicitly marked as not production-safe", () => {
    expect(sandbox.isProductionSafe).toBe(false);
  });

  it("actually executes and captures output (proving the test harness itself works)", async () => {
    const result = await sandbox.execute({ command: ["echo", "sandbox-smoke-test"] });
    expect(result.status).toBe("completed");
    expect(result.stdout.trim()).toBe("sandbox-smoke-test");
  }, 10_000);
});
