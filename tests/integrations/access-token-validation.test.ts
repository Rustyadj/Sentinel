/**
 * Access-token validation at the MCP resource server: which bearer tokens are
 * accepted, and what identity an accepted one resolves to.
 *
 * The identity mapping is the security-relevant half. An accepted token must
 * carry the Sentinel user it was consented by, because every MCP tool scopes
 * its reads with principal.userId -- getReadableProjectIds(userId),
 * memoryReadWhere(userId). A token that resolved to the wrong user, or to no
 * user, would either leak another tenant's data or silently resolve to an
 * empty permitted scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { oAuthAccessToken: { findUnique: prisma.findUnique, update: prisma.update } },
}));

import { authenticateAccessToken, hashOpaqueSecret } from "@/lib/integrations/oauth";

const TOKEN = "Zm9vYmFyYmF6cXV4LXRoaXJ0eS10d28tY2hhcnMtbG9uZw";
const USER_ID = "user-under-test";

function storedToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    tokenHash: hashOpaqueSecret(TOKEN),
    externalClientId: "client-row-1",
    userId: USER_ID,
    scopes: ["sentinel.read", "sentinel.memory.read"],
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    externalClient: { clientId: "dcr-chatgpt", enabled: true },
    ...overrides,
  };
}

beforeEach(() => {
  prisma.findUnique.mockReset();
  prisma.update.mockReset();
  prisma.update.mockResolvedValue({});
});

describe("access-token validation", () => {
  it("accepts a live token and maps it to the consenting Sentinel user", async () => {
    prisma.findUnique.mockResolvedValue(storedToken());

    const principal = await authenticateAccessToken(`Bearer ${TOKEN}`);

    expect(principal).toMatchObject({
      userId: USER_ID,
      clientId: "dcr-chatgpt",
      externalClientId: "client-row-1",
      scopes: ["sentinel.read", "sentinel.memory.read"],
    });
  });

  it("looks the token up by hash and never by its plaintext", async () => {
    prisma.findUnique.mockResolvedValue(storedToken());
    await authenticateAccessToken(`Bearer ${TOKEN}`);

    const where = prisma.findUnique.mock.calls[0][0].where;
    expect(where).toEqual({ tokenHash: hashOpaqueSecret(TOKEN) });
    expect(JSON.stringify(where)).not.toContain(TOKEN);
  });

  it("rejects an expired token", async () => {
    prisma.findUnique.mockResolvedValue(storedToken({ expiresAt: new Date(Date.now() - 1_000) }));
    await expect(authenticateAccessToken(`Bearer ${TOKEN}`)).resolves.toBeNull();
  });

  it("rejects a revoked token", async () => {
    prisma.findUnique.mockResolvedValue(storedToken({ revokedAt: new Date() }));
    await expect(authenticateAccessToken(`Bearer ${TOKEN}`)).resolves.toBeNull();
  });

  // Disabling a client must take effect immediately, not an access-token
  // lifetime later.
  it("rejects a live token whose client has been disabled", async () => {
    prisma.findUnique.mockResolvedValue(
      storedToken({ externalClient: { clientId: "dcr-chatgpt", enabled: false } }),
    );
    await expect(authenticateAccessToken(`Bearer ${TOKEN}`)).resolves.toBeNull();
  });

  it("rejects an unknown token", async () => {
    prisma.findUnique.mockResolvedValue(null);
    await expect(authenticateAccessToken(`Bearer ${TOKEN}`)).resolves.toBeNull();
  });

  it("rejects a missing or malformed Authorization header without touching the database", async () => {
    for (const header of [null, "", "Bearer", "Basic abcdefghijklmnopqrstuvwxyz012345", `Bearer short`]) {
      await expect(authenticateAccessToken(header)).resolves.toBeNull();
    }
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });
});
