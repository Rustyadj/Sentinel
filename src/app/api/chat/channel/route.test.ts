import { beforeEach, afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), room: vi.fn(), messages: vi.fn(), runtime: vi.fn(), permission: vi.fn(),
  get: vi.fn(), acquire: vi.fn(), release: vi.fn(), set: vi.fn(), begin: vi.fn(), plan: vi.fn(),
  route: vi.fn(), record: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, chatRoom: { upsert: m.room }, message: { findMany: m.messages } } }));
vi.mock("@/lib/agents/runtime/chat-routing", () => ({ routeRuntimeChat: m.route }));
vi.mock("@/lib/agents/runtime/service", () => ({ getRuntimeView: m.runtime }));
vi.mock("@/lib/agents/runtime/authorization", () => ({ RUNTIME_PERMISSIONS: { execute: "agents.runtime.execute" } }));
vi.mock("@/lib/workspaces/authorization", () => ({ userHasWorkspacePermission: m.permission }));
vi.mock("@/lib/redis", () => ({ redisGet: m.get, redisAcquireLease: m.acquire, redisReleaseLease: m.release, redisSet: m.set }));
vi.mock("@/lib/system-one/turn", () => ({ beginSystemOne: m.begin, planForTurn: m.plan }));
vi.mock("@/lib/system-one/telemetry", () => ({ RequestTrace: class { mark() {} }, recordDecision: m.record }));
import { POST } from "./route";

const message = { platform: "telegram", senderId: "sender", chatId: "chat", messageId: "1", text: "Hello" };
function request(body = message, secret = "test-secret") {
  return new Request("http://localhost/api/chat/channel", { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${secret}` } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("HERMES_CHANNEL_SECRET", "test-secret");
  vi.stubEnv("HERMES_CHANNEL_USERS", JSON.stringify({ telegram: { sender: "owner" } }));
  m.user.mockResolvedValue({ id: "owner" });
  m.runtime.mockResolvedValue({ id: "runtime-hermes-lisa", workspaceId: "workspace" });
  m.permission.mockResolvedValue(true);
  m.room.mockResolvedValue({ userId: "owner", agentIds: ["hermes-lisa"], projectId: null });
  m.messages.mockResolvedValue([]);
  m.get.mockResolvedValue(null);
  m.acquire.mockResolvedValue(true);
  m.begin.mockReturnValue({ mode: "active", result: Promise.resolve({ outcome: "ok", provider: "jev", providerModel: "jev-test" }) });
  m.route.mockImplementation(async (_input, authorize) => {
    await authorize("runtime-hermes-lisa");
    return new Response('data: {"type":"text","text":"Hello from Lisa"}\n\ndata: [DONE]\n\n');
  });
});
afterEach(() => vi.unstubAllEnvs());

it("requires the private transport credential", async () => {
  expect((await POST(request(message, "incorrect"))).status).toBe(401);
  expect(m.user).not.toHaveBeenCalled();
});
it("requires an explicit sender binding, even with a valid machine credential", async () => {
  expect((await POST(request({ ...message, senderId: "stranger" }))).status).toBe(403);
  expect(m.route).not.toHaveBeenCalled();
});
it("checks the bound user's current workspace permissions", async () => {
  m.permission.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(403);
  expect(m.begin).not.toHaveBeenCalled();
});
it("evaluates Jev before Lisa and ignores caller-supplied user and agent IDs", async () => {
  let resolve!: (value: unknown) => void;
  m.begin.mockReturnValue({ mode: "active", result: new Promise(r => { resolve = r; }) });
  const pending = POST(request({ ...message, userId: "attacker", agentId: "codex" } as typeof message));
  await vi.waitFor(() => expect(m.begin).toHaveBeenCalled());
  expect(m.route).not.toHaveBeenCalled();
  resolve({ outcome: "ok", provider: "jev", providerModel: "jev-test" });
  const response = await pending;
  expect(response.status).toBe(200);
  expect(m.route.mock.calls[0][0]).toMatchObject({ agentId: "hermes-lisa", userId: "owner" });
  expect(await response.json()).toMatchObject({ text: "Hello from Lisa", routing: { provider: "jev", mode: "active" } });
});
it("reuses a completed delivery without executing it again", async () => {
  m.get.mockResolvedValue(JSON.stringify({ text: "Cached reply" }));
  expect(await (await POST(request())).json()).toEqual({ text: "Cached reply" });
  expect(m.route).not.toHaveBeenCalled();
});
it("refuses an uncertain duplicate delivery", async () => {
  m.acquire.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(409);
  expect(m.route).not.toHaveBeenCalled();
});
it("refuses work when the conversation lock or Redis is unavailable", async () => {
  m.acquire.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(409);
  expect(m.route).not.toHaveBeenCalled();
});
it("refuses a room whose owner or project scope changed", async () => {
  m.room.mockResolvedValue({ userId: "other", agentIds: ["hermes-lisa"], projectId: null });
  expect((await POST(request())).status).toBe(403);
  expect(m.begin).not.toHaveBeenCalled();
});
it("returns an error when Lisa's stream fails instead of caching a partial success", async () => {
  m.route.mockResolvedValue(new Response('data: {"type":"error","error":"Runtime offline"}\n\ndata: [DONE]\n\n'));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await POST(request())).status).toBe(503);
  expect(m.set).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalled();
  quiet.mockRestore();
});
