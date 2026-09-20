import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { user: { findMany } } }));

import { findCredentialIdentity, findEmailIdentities } from "@/lib/auth/identity";

beforeEach(() => findMany.mockReset());

describe("case-insensitive identity resolution", () => {
  it("queries the complete normalized identity set", async () => {
    findMany.mockResolvedValue([]);
    await findEmailIdentities("  Owner@Example.COM ");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: "owner@example.com", mode: "insensitive" } },
    }));
  });

  it("selects the sole credentials identity when a social duplicate has no password", async () => {
    const credential = { id: "original", passwordHash: "hash", createdAt: new Date(0) };
    findMany.mockResolvedValue([credential, { id: "social-duplicate", passwordHash: null, createdAt: new Date(1) }]);
    await expect(findCredentialIdentity("owner@example.com")).resolves.toBe(credential);
  });

  it("fails closed when more than one case-only identity can authenticate by password", async () => {
    findMany.mockResolvedValue([
      { id: "one", passwordHash: "hash-1" },
      { id: "two", passwordHash: "hash-2" },
    ]);
    await expect(findCredentialIdentity("owner@example.com")).resolves.toBeNull();
  });
});
