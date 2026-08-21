import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "../../../../tests/neural-engine/db-setup";

const mocks = vi.hoisted(() => ({ requireApiUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireApiUser: mocks.requireApiUser }));

import { GET } from "./route";

afterAll(async () => db.$disconnect());
beforeEach(() => vi.clearAllMocks());

async function getRooms() {
  const res = await GET(new Request("http://localhost/api/rooms") as unknown as Parameters<typeof GET>[0]);
  return res.json() as Promise<{ id: string; isPrimary: boolean; mode: string }[]>;
}

describe("GET /api/rooms — Lisa-first primary room defaults", () => {
  it("auto-creates a primary, collaborative Mission Control room for a brand-new user", async () => {
    const user = await makeUser();
    mocks.requireApiUser.mockResolvedValue(user);

    const rooms = await getRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].isPrimary).toBe(true);
    expect(rooms[0].mode).toBe("collaborative");
  });

  it("resets the primary room back to collaborative even if it was left in solo mode", async () => {
    const user = await makeUser();
    mocks.requireApiUser.mockResolvedValue(user);
    await getRooms(); // auto-create

    const primary = await db.chatRoom.findFirstOrThrow({ where: { userId: user.id, isPrimary: true } });
    await db.chatRoom.update({ where: { id: primary.id }, data: { mode: "solo" } });

    const rooms = await getRooms();
    const resolved = rooms.find((room) => room.id === primary.id)!;
    expect(resolved.mode).toBe("collaborative");
  });

  it("does not reset an explicitly-created direct-worker (non-primary) room's mode", async () => {
    const user = await makeUser();
    mocks.requireApiUser.mockResolvedValue(user);
    await getRooms(); // creates the primary room

    const direct = await db.chatRoom.create({ data: { name: "Direct with Codex", userId: user.id, agentIds: ["codex"], mode: "solo" } });

    const rooms = await getRooms();
    const resolvedDirect = rooms.find((room) => room.id === direct.id)!;
    expect(resolvedDirect.isPrimary).toBe(false);
    expect(resolvedDirect.mode).toBe("solo");
  });

  it("promotes the oldest room to primary when no room is flagged yet (legacy data)", async () => {
    const user = await makeUser();
    mocks.requireApiUser.mockResolvedValue(user);
    const older = await db.chatRoom.create({ data: { name: "Older room", userId: user.id, agentIds: ["hermes-lisa"], mode: "solo" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.chatRoom.create({ data: { name: "Newer room", userId: user.id, agentIds: ["hermes-lisa"] } });

    const rooms = await getRooms();
    const primaryRooms = rooms.filter((room) => room.isPrimary);
    expect(primaryRooms).toHaveLength(1);
    expect(primaryRooms[0].id).toBe(older.id);
    // Promoting it to primary also resets it to collaborative.
    expect(primaryRooms[0].mode).toBe("collaborative");
  });
});
