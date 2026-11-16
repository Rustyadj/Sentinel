// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const actor = vi.hoisted(() => ({ id: "", name: "Reader" }));
vi.mock("@/lib/current-user", () => ({ requireApiUser: async () => actor }));
import { db } from "@/lib/db";
import { GET } from "@/app/api/rooms/[roomId]/messages/route";

it("returns the latest capped message window and keeps cursor pagination ascending", async () => {
  const user = await db.user.create({ data: { email: `message-window-${randomUUID()}@test.sentinel` } });
  actor.id = user.id;
  const room = await db.chatRoom.create({ data: { name: "Long transcript", userId: user.id } });
  const start = Date.now();
  await db.message.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
    id: `window-${room.id}-${index}`, chatRoomId: room.id, role: "user", content: `message ${index}`, createdAt: new Date(start + index),
  })) });
  const response = await GET(new NextRequest(`http://localhost/api/rooms/${room.id}/messages?limit=200`), { params: Promise.resolve({ roomId: room.id }) });
  const messages = await response.json();
  expect(response.status).toBe(200);
  expect(messages).toHaveLength(200);
  expect(messages[0].content).toBe("message 5");
  expect(messages.at(-1).content).toBe("message 204");
  const after = await GET(new NextRequest(`http://localhost/api/rooms/${room.id}/messages?limit=2&cursor=${messages[0].id}`), { params: Promise.resolve({ roomId: room.id }) });
  expect((await after.json()).map((message: { content: string }) => message.content)).toEqual(["message 6", "message 7"]);
});
