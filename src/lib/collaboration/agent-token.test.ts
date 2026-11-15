import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectAgentToken } from "./agent-token";

describe("projectAgentToken", () => {
  const original = process.env.AUTH_SECRET;
  beforeEach(() => { process.env.AUTH_SECRET = "test-secret"; });
  afterEach(() => { if (original === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = original; });

  it("is stable for an agent, and different for another agent, version or server secret", () => {
    const token = projectAgentToken("row-1", 1);
    expect(token).toMatch(/^sntl_a2a_[A-Za-z0-9_-]{43}$/);
    expect(projectAgentToken("row-1", 1)).toBe(token);
    expect(projectAgentToken("row-2", 1)).not.toBe(token);
    expect(projectAgentToken("row-1", 2)).not.toBe(token);
    process.env.AUTH_SECRET = "another-secret";
    expect(projectAgentToken("row-1", 1)).not.toBe(token);
  });

  it("refuses to issue a token without a server secret", () => {
    delete process.env.AUTH_SECRET;
    expect(() => projectAgentToken("row-1", 1)).toThrow("AUTH_SECRET");
  });
});
