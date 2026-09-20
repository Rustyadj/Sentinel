/**
 * RFC 8707 resource-indicator comparison.
 *
 * The indicator is an audience binding: a token minted for one resource must
 * never authenticate against another, so this has to stay equality rather
 * than any kind of prefix or origin match. But it is equality on the
 * normalised URI — a client that canonicalises `/api/mcp` as `/api/mcp/`, or
 * uppercases the host, is conformant and must not be turned away at
 * /authorize with invalid_target before it ever reaches a consent screen.
 */
import { describe, expect, it } from "vitest";
import { isSameResource } from "@/lib/integrations/oauth";

const CANONICAL = "https://sentinel.srv1427612.hstgr.cloud/api/mcp";

describe("isSameResource", () => {
  it("matches the canonical form", () => {
    expect(isSameResource(CANONICAL, CANONICAL)).toBe(true);
  });

  it("ignores a trailing slash on either side", () => {
    expect(isSameResource(`${CANONICAL}/`, CANONICAL)).toBe(true);
    expect(isSameResource(CANONICAL, `${CANONICAL}/`)).toBe(true);
    expect(isSameResource(`${CANONICAL}//`, CANONICAL)).toBe(true);
  });

  it("treats scheme and host as case-insensitive, per RFC 3986", () => {
    expect(isSameResource("HTTPS://SENTINEL.SRV1427612.HSTGR.CLOUD/api/mcp", CANONICAL)).toBe(true);
  });

  it("keeps the path case-sensitive", () => {
    expect(isSameResource("https://sentinel.srv1427612.hstgr.cloud/API/MCP", CANONICAL)).toBe(false);
  });

  it("rejects a different host", () => {
    expect(isSameResource("https://evil.example/api/mcp", CANONICAL)).toBe(false);
  });

  it("rejects a different scheme", () => {
    expect(isSameResource("http://sentinel.srv1427612.hstgr.cloud/api/mcp", CANONICAL)).toBe(false);
  });

  it("rejects a parent path — this is not a prefix match", () => {
    expect(isSameResource("https://sentinel.srv1427612.hstgr.cloud/api", CANONICAL)).toBe(false);
    expect(isSameResource("https://sentinel.srv1427612.hstgr.cloud", CANONICAL)).toBe(false);
  });

  it("rejects a deeper path", () => {
    expect(isSameResource(`${CANONICAL}/tools`, CANONICAL)).toBe(false);
  });

  it("keeps a query string significant", () => {
    expect(isSameResource(`${CANONICAL}?tenant=other`, CANONICAL)).toBe(false);
  });

  // RFC 8707 section 2 forbids a fragment on a resource indicator.
  it("rejects an indicator carrying a fragment", () => {
    expect(isSameResource(`${CANONICAL}#frag`, CANONICAL)).toBe(false);
  });

  it("rejects absent, empty and unparseable values", () => {
    expect(isSameResource(null, CANONICAL)).toBe(false);
    expect(isSameResource(undefined, CANONICAL)).toBe(false);
    expect(isSameResource("", CANONICAL)).toBe(false);
    expect(isSameResource("not a url", CANONICAL)).toBe(false);
    expect(isSameResource(CANONICAL, "not a url")).toBe(false);
  });
});
