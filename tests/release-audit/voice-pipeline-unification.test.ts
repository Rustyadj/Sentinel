import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeAgent, makeUser, uid } from "../neural-engine/db-setup";

const mocks = vi.hoisted(() => ({
  requireAgentRecordUser: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => { throw new Error("voice worker has no browser session"); }),
}));
vi.mock("@/lib/agents/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/permissions")>();
  return { ...actual, requireAgentRecordUser: mocks.requireAgentRecordUser };
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: mocks.anthropicCreate };
  },
}));

import { POST } from "@/app/api/chat/route";

function voiceRequest(roomId: string, userContent: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer voice-test-secret",
    },
    body: JSON.stringify({ roomId, userContent }),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("voice uses the canonical text-chat learning and knowledge pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_WORKER_SECRET = "voice-test-secret";
    process.env.ANTHROPIC_API_KEY = "test-key";
    mocks.requireAgentRecordUser.mockResolvedValue({ id: "voice-user" });
    mocks.anthropicCreate.mockImplementation(async () => (async function* stream() {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Unified voice response." } };
      yield { type: "message_stop" };
    })());
  });

  afterEach(() => {
    delete process.env.VOICE_WORKER_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(async () => db.$disconnect());

  it("persists messages, bridges retrieved memory, and captures an Experience for a worker transcript", async () => {
    const user = await makeUser();
    const agent = await makeAgent("Voice pipeline agent");
    await db.agent.update({ where: { id: agent.id }, data: { model: "claude-sonnet-4-6" } });
    const room = await db.chatRoom.create({
      data: { name: uid("voice-room"), userId: user.id, agentIds: [agent.id] },
    });
    const memory = await db.memory.create({
      data: {
        type: "fact",
        scope: "user",
        owner: user.id,
        content: "Deployment architecture uses the canonical Sentinel chat pipeline.",
        tags: ["voice-regression"],
        source: "voice-pipeline-test",
      },
    });
    const userContent = "Please summarize the known deployment architecture and return a concise operational answer.";

    const response = await POST(voiceRequest(room.id, userContent));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Unified voice response.");

    await vi.waitFor(async () => {
      expect(await db.experience.count({ where: { conversationId: room.id } })).toBe(1);
    }, { timeout: 5_000, interval: 50 });

    const [messages, bridged, experience] = await Promise.all([
      db.message.findMany({ where: { chatRoomId: room.id }, orderBy: { createdAt: "asc" } }),
      db.knowledgeObject.findFirst({ where: { sourceType: "memory", sourceId: memory.id } }),
      db.experience.findFirst({ where: { conversationId: room.id }, include: { outcome: true, evaluations: true } }),
    ]);
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", userContent],
      ["agent", "Unified voice response."],
    ]);
    expect(bridged).not.toBeNull();
    expect(experience).toMatchObject({
      agentId: agent.id,
      conversationId: room.id,
      outcomeStatus: "success",
      outcome: { status: "success" },
    });
    expect(experience?.knowledgeUsed).toContain(bridged?.id);
    expect(experience?.evaluations).toHaveLength(1);
  });
});
