/**
 * Refresh-token grant: rotation, replay, and every binding that must survive.
 *
 * Runs against an in-memory stand-in for the three OAuth tables rather than a
 * database, so the whole grant -- including the atomic single-use claim -- is
 * exercised with no external dependency. The store mimics Prisma's semantics
 * for the operations the implementation actually relies on, in particular
 * updateMany returning a count so the compare-and-set can be tested.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  [key: string]: unknown;
}

const store = vi.hoisted(() => {
  const tables: Record<string, Row[]> = { refresh: [], access: [], client: [], code: [] };
  let seq = 0;
  const nextId = (p: string) => `${p}_${++seq}`;

  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "in" in (value as Record<string, unknown>)) {
        return ((value as { in: unknown[] }).in ?? []).includes(row[key]);
      }
      return row[key] === value;
    });

  const delegate = (table: string, prefix: string) => ({
    async create({ data }: { data: Record<string, unknown> }) {
      // Postgres gives an unset nullable column NULL, and Prisma returns null.
      // Defaulting these to undefined instead would silently exempt new rows
      // from every `revokedAt: null` / `rotatedAt: null` predicate the
      // implementation relies on.
      const row: Row = { id: nextId(prefix), createdAt: new Date(), revokedAt: null, rotatedAt: null, ...data };
      tables[table].push(row);
      return row;
    },
    async findUnique({ where }: { where: Record<string, unknown> }) {
      return tables[table].find((row) => matches(row, where)) ?? null;
    },
    async findMany({ where, select }: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) {
      const rows = tables[table].filter((row) => (where ? matches(row, where) : true));
      if (!select) return rows;
      return rows.map((row) =>
        Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])),
      );
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const rows = tables[table].filter((row) => matches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const row = tables[table].find((entry) => matches(entry, where));
      if (row) Object.assign(row, data);
      return row;
    },
  });

  return { tables, delegate, reset: () => Object.keys(tables).forEach((k) => (tables[k] = [])) };
});

vi.mock("@/lib/db", () => ({
  db: {
    oAuthRefreshToken: store.delegate("refresh", "rt"),
    oAuthAccessToken: store.delegate("access", "at"),
    externalClient: store.delegate("client", "cl"),
    oAuthAuthorizationCode: store.delegate("code", "code"),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

import {
  OAUTH_LIFETIMES,
  OAuthProtocolError,
  exchangeRefreshToken,
  hashOpaqueSecret,
  randomOpaqueSecret,
  revokeRefreshTokenFamily,
} from "@/lib/integrations/oauth";

const ALL = ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];
const USER = "user-1";
const RESOURCE = "https://sentinel.test/api/mcp";

beforeEach(() => store.reset());

function makeClient(overrides: Record<string, unknown> = {}) {
  const row: Row = {
    id: `client-${store.tables.client.length + 1}`,
    clientId: `dcr-${store.tables.client.length + 1}`,
    clientSecretHash: null,
    enabled: true,
    grantTypes: ["authorization_code", "refresh_token"],
    allowedScopes: ALL,
    ...overrides,
  };
  store.tables.client.push(row);
  return row;
}

/** Seeds a refresh token the way issueTokenSet would have. */
function seedRefreshToken(client: Row, overrides: Record<string, unknown> = {}) {
  const token = randomOpaqueSecret();
  const access: Row = { id: `at-seed-${store.tables.access.length + 1}`, revokedAt: null };
  store.tables.access.push(access);
  store.tables.refresh.push({
    id: `rt-seed-${store.tables.refresh.length + 1}`,
    tokenHash: hashOpaqueSecret(token),
    externalClientId: client.id,
    userId: USER,
    scopes: ALL,
    resource: RESOURCE,
    familyId: "fam-1",
    previousTokenId: null,
    accessTokenId: access.id,
    rotatedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + OAUTH_LIFETIMES.refreshTokenTtlMs),
    ...overrides,
  });
  return token;
}

const refresh = (client: Row, token: string, extra: Record<string, unknown> = {}) =>
  exchangeRefreshToken({ clientId: client.clientId as string, refreshToken: token, resource: RESOURCE, ...extra });

describe("refresh token rotation", () => {
  it("mints a new access token and a new refresh token", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);

    const result = await refresh(client, token);
    expect(result.kind).toBe("rotated");
    if (result.kind !== "rotated") return;
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(result.tokens.refreshToken).not.toBe(token);
  });

  it("marks the presented token rotated so it is single-use", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    await refresh(client, token);
    const original = store.tables.refresh.find((row) => row.tokenHash === hashOpaqueSecret(token));
    expect(original?.rotatedAt).toBeTruthy();
  });

  it("keeps the successor in the same rotation family and links the lineage", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token);
    if (result.kind !== "rotated") throw new Error("expected rotation");

    const successor = store.tables.refresh.find(
      (row) => row.tokenHash === hashOpaqueSecret(result.tokens.refreshToken as string),
    );
    expect(successor?.familyId).toBe("fam-1");
    expect(successor?.previousTokenId).toBe("rt-seed-1");
  });

  it("stores only a hash, never the plaintext refresh token", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token);
    if (result.kind !== "rotated") throw new Error("expected rotation");

    const serialized = JSON.stringify(store.tables.refresh);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(result.tokens.refreshToken);
    expect(serialized).toContain(hashOpaqueSecret(result.tokens.refreshToken as string));
  });
});

describe("replay detection", () => {
  it("rejects a token that was already rotated and revokes the whole family", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const first = await refresh(client, token);
    if (first.kind !== "rotated") throw new Error("expected rotation");

    const replay = await refresh(client, token);
    expect(replay.kind).toBe("replay");

    // Everything in the family dies, including the successor just issued.
    expect(store.tables.refresh.every((row) => row.revokedAt)).toBe(true);
    expect(store.tables.access.every((row) => row.revokedAt)).toBe(true);
  });

  it("does not mint anything on replay", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    await refresh(client, token);
    const countAfterFirst = store.tables.refresh.length;

    await refresh(client, token);
    expect(store.tables.refresh.length).toBe(countAfterFirst);
  });

  it("leaves the rotated successor unusable once the family is revoked", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const first = await refresh(client, token);
    if (first.kind !== "rotated") throw new Error("expected rotation");
    await refresh(client, token); // replay revokes the family

    await expect(refresh(client, first.tokens.refreshToken as string)).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("binding", () => {
  it("refuses a refresh token at a different protected resource", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    await expect(exchangeRefreshToken({
      clientId: client.clientId as string,
      refreshToken: token,
      resource: "https://other.example/api/mcp",
    })).rejects.toMatchObject({ code: "invalid_target" });
  });

  it("keeps the protected resource bound across rotation", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token);
    if (result.kind !== "rotated") throw new Error("expected rotation");
    expect(store.tables.access.at(-1)?.resource).toBe(RESOURCE);
    expect(store.tables.refresh.at(-1)?.resource).toBe(RESOURCE);
  });

  it("refuses a refresh token presented by a different client", async () => {
    const owner = makeClient();
    const attacker = makeClient();
    const token = seedRefreshToken(owner);

    await expect(refresh(attacker, token)).rejects.toMatchObject({ code: "invalid_grant" });
    // The token is burned defensively -- it has demonstrably leaked.
    expect(store.tables.refresh.every((row) => row.revokedAt)).toBe(true);
  });

  it("preserves the user identity across rotation", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token);
    if (result.kind !== "rotated") throw new Error("expected rotation");

    expect(result.userId).toBe(USER);
    expect(store.tables.access.at(-1)?.userId).toBe(USER);
    expect(store.tables.refresh.at(-1)?.userId).toBe(USER);
  });

  it("refuses a client that never registered for the refresh grant", async () => {
    const client = makeClient({ grantTypes: ["authorization_code"] });
    const token = seedRefreshToken(client);
    await expect(refresh(client, token)).rejects.toMatchObject({ code: "unauthorized_client" });
  });

  it("refuses a disabled client", async () => {
    const client = makeClient({ enabled: false });
    const token = seedRefreshToken(client);
    await expect(refresh(client, token)).rejects.toMatchObject({ code: "invalid_client" });
  });
});

describe("scopes", () => {
  it("carries the originally consented scopes forward unchanged", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token);
    if (result.kind !== "rotated") throw new Error("expected rotation");
    expect(result.tokens.scopes).toEqual(ALL);
  });

  it("allows narrowing", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token, { scope: "sentinel.read" });
    if (result.kind !== "rotated") throw new Error("expected rotation");
    expect(result.tokens.scopes).toEqual(["sentinel.read"]);
  });

  it("refuses widening beyond what was consented", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client, { scopes: ["sentinel.read"] });
    await expect(refresh(client, token, { scope: "sentinel.read sentinel.tasks.write" })).rejects.toMatchObject({
      code: "invalid_scope",
    });
  });

  it("refuses an unknown scope", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    await expect(refresh(client, token, { scope: "sentinel.admin" })).rejects.toBeInstanceOf(OAuthProtocolError);
  });

  it("narrowing does not later re-widen", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const narrowed = await refresh(client, token, { scope: "sentinel.read" });
    if (narrowed.kind !== "rotated") throw new Error("expected rotation");

    await expect(
      refresh(client, narrowed.tokens.refreshToken as string, { scope: "sentinel.tasks.write" }),
    ).rejects.toMatchObject({ code: "invalid_scope" });
  });
});

describe("expiry and revocation", () => {
  it("refuses an expired refresh token", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client, { expiresAt: new Date(Date.now() - 1_000) });
    await expect(refresh(client, token)).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses a revoked refresh token", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client, { revokedAt: new Date() });
    await expect(refresh(client, token)).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses an unknown refresh token", async () => {
    const client = makeClient();
    seedRefreshToken(client);
    await expect(refresh(client, randomOpaqueSecret())).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("revoking a family kills its refresh tokens and their access tokens", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    await revokeRefreshTokenFamily("fam-1");

    expect(store.tables.refresh.every((row) => row.revokedAt)).toBe(true);
    expect(store.tables.access.every((row) => row.revokedAt)).toBe(true);
    await expect(refresh(client, token)).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("lifetimes", () => {
  it("keeps access tokens short and refresh tokens long, from one place", () => {
    expect(OAUTH_LIFETIMES.accessTokenTtlMs).toBeLessThanOrEqual(60 * 60 * 1_000);
    expect(OAUTH_LIFETIMES.refreshTokenTtlMs).toBeGreaterThan(OAUTH_LIFETIMES.accessTokenTtlMs);
    // Long-lived, but never permanent.
    expect(Number.isFinite(OAUTH_LIFETIMES.refreshTokenTtlMs)).toBe(true);
  });

  it("issues a refresh token that expires", async () => {
    const client = makeClient();
    const token = seedRefreshToken(client);
    const result = await refresh(client, token);
    if (result.kind !== "rotated") throw new Error("expected rotation");
    expect(result.tokens.refreshTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
