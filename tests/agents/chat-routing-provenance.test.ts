// Typed chat with a Hermes agent: the session's pinned model must survive the chat route's own bookkeeping.
// routeRuntimeChat used to REPLACE the session's metadata with {lastTask, source}, erasing the model the
// session was started with; HermesRuntimeAdapter.send then refused with "Session model provenance missing", so
// the first message to Hermes Lisa / Nathan2 from the chat page failed. Found by driving it in a real browser.
import { beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ runtimeId: "", workspaceId: "", userId: "" }));
vi.mock("@/lib/agents/runtime/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agents/runtime/authorization")>("@/lib/agents/runtime/authorization");
  return {
    ...actual,
    requireRuntimeAccess: async () => ({ user: { id: state.userId }, runtime: { id: state.runtimeId, agentId: "hermes-lisa", kind: "hermes", workspaceId: state.workspaceId, enabled: true, executionVerified: true, transport: "http", endpoint: "http://x", capabilities: {}, args: [] } }),
    validateSessionScope: async () => undefined,
  };
});
const adapter = vi.hoisted(() => ({ sends: [] as string[] }));
vi.mock("@/lib/agents/runtime/service", async () => {
  const { runtimeSessionStore } = await import("@/lib/agents/runtime/store");
  const { modelProvenance } = await import("@/lib/agents/model-policy");
  return {
    getRuntimeAdapter: () => ({
      readiness: async () => ({ ready: true }),
      startSession: async (input: { runtimeId: string; userId: string; workspaceId?: string }) => {
        const created = await runtimeSessionStore.create(input as never, "hermes", "hermes-lisa", undefined, `ext-${Math.random().toString(36).slice(2)}`);
        return runtimeSessionStore.update(created.id, { metadata: modelProvenance("hermes-lisa", "hermes", { runtimeModelId: "pinned-model-1", displayName: "pinned-model-1", effort: null, source: "agent" }) });
      },
      // What HermesRuntimeAdapter.send does first.
      send: async function* (input: { sessionId: string }) {
        const session = await runtimeSessionStore.get(input.sessionId);
        if (!session || !(session.metadata as { requestedModel?: string }).requestedModel) throw new Error("Session model provenance missing");
        adapter.sends.push(input.sessionId);
        yield { type: "assistant_delta", sessionId: input.sessionId, sequence: 1, timestamp: new Date().toISOString(), data: { text: "hello from the pinned session" } };
      },
    }),
  };
});

import { db } from "@/lib/db";
import { routeRuntimeChat } from "@/lib/agents/runtime/chat-routing";
import { runtimeSessionStore } from "@/lib/agents/runtime/store";

async function readStream(response: Response) {
  return (await response.text()).split("\n\n").filter((chunk) => chunk.startsWith("data: ") && !chunk.includes("[DONE]")).map((chunk) => JSON.parse(chunk.slice(6)) as { type: string; text?: string; error?: string });
}

let roomId = "";
beforeAll(async () => {
  const id = Date.now().toString(36);
  const user = await db.user.create({ data: { email: `chat-prov-${id}@test.sentinel` } });
  const workspace = await db.workspace.create({ data: { slug: `chat-prov-${id}`, name: "Chat provenance", ownerId: user.id } });
  const runtime = await db.agentRuntime.create({ data: { agentId: "hermes-lisa", kind: "hermes", transport: "http", workspaceId: workspace.id } });
  roomId = (await db.chatRoom.create({ data: { name: "provenance room", userId: user.id } as never })).id;
  Object.assign(state, { runtimeId: runtime.id, workspaceId: workspace.id, userId: user.id });
});

describe("routeRuntimeChat keeps the session pinned to its model", () => {
  it("streams the reply and leaves the pinned model in the session's metadata", async () => {
    const events = await readStream(await routeRuntimeChat({ agentId: "hermes-lisa", userId: state.userId, roomId, userContent: "first message", mode: "persistent_agent_runtime" }));
    expect(events.find((e) => e.type === "error"), JSON.stringify(events)).toBeUndefined();
    expect(events.filter((e) => e.type === "text").map((e) => e.text).join("")).toBe("hello from the pinned session");

    const [session] = await db.agentSession.findMany({ where: { chatRoomId: roomId } });
    expect(session.metadata).toMatchObject({ requestedModel: "pinned-model-1", lastTask: "first message", source: "chat" });
  });

  it("a second turn on the same conversation works too", async () => {
    const events = await readStream(await routeRuntimeChat({ agentId: "hermes-lisa", userId: state.userId, roomId, userContent: "second message", mode: "persistent_agent_runtime" }));
    expect(events.find((e) => e.type === "error"), JSON.stringify(events)).toBeUndefined();
    const sessions = await db.agentSession.findMany({ where: { chatRoomId: roomId } });
    expect(sessions).toHaveLength(1);                       // reused, not restarted
    expect(await runtimeSessionStore.get(sessions[0].id)).toMatchObject({ metadata: { requestedModel: "pinned-model-1", lastTask: "second message" } });
  });
});
