// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { OutsideAgentError, type OutsideRequest, type OutsideTransport } from "@/lib/collaboration/a2a/http";
import { projectAgentToken } from "@/lib/collaboration/agent-token";
import {
  bringOutsideAgent, listProjectAgents, MAX_OUTSIDE_AGENTS_PER_PERSON, ProjectAgentError, recheckProjectAgent,
  removeProjectAgent, rotateProjectAgentToken, updateProjectAgent,
} from "@/lib/collaboration/project-agents";
import { runCollaborationTurn } from "@/lib/orchestration/orchestrator";
import { runOutsideAgentReply } from "@/lib/orchestration/outside-agent-turn";
import { getRoomSnapshot } from "@/lib/orchestration/room-state";
import { ensureHomeOrganization } from "@/lib/people/organization";

// Who may bring, pause and remove an agent is decided by rows and queries, so
// this runs against a real database. The agent's server is either a stand-in
// transport (to see exactly what Sentinel sends) or, for the end-to-end case,
// a real HTTP server speaking A2A.

const signedIn = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/current-user", () => ({
  requireUser: async () => { if (!signedIn.user) throw new Error("Unauthorized"); return signedIn.user; },
  requireApiUser: async () => { if (!signedIn.user) throw new Error("Unauthorized"); return signedIn.user; },
}));

const tag = randomUUID().slice(0, 8);
const makeUser = (name: string, accessScope = "member") => db.user.create({ data: { email: `${name}-${tag}@agents.test`, name, accessScope } });
type User = Awaited<ReturnType<typeof makeUser>>;

let owner: User, guest: User, otherGuest: User, viewer: User;
let project: { id: string; userId: string };
let roomId: string;

const card = (name = "Ledger Bot") => ({ name, description: "Reconciles invoices.", supportedInterfaces: [{ url: "https://agent.example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }] });
const cardOnly = (name?: string): OutsideTransport => async () => card(name);
const bring = (user: User, url = `https://agent-${randomUUID().slice(0, 6)}.example.com`, transport = cardOnly()) =>
  bringOutsideAgent({ project, ownerUserId: user.id, url }, transport);

async function expectStatus(run: Promise<unknown>, status: number) {
  const error = await run.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ProjectAgentError);
  expect((error as ProjectAgentError).status).toBe(status);
}
const roomMessages = () => db.message.findMany({ where: { chatRoomId: roomId }, orderBy: { createdAt: "asc" } });
const lastEvent = async () => (await db.collaborationEvent.findFirst({ where: { chatRoomId: roomId }, orderBy: { sequence: "desc" } }))!;

beforeAll(async () => {
  process.env.AUTH_SECRET ??= "project-agents-test-secret";
  await ensureHomeOrganization();
  [owner, guest, otherGuest, viewer] = await Promise.all([makeUser("owner"), makeUser("guest", "guest"), makeUser("other-guest", "guest"), makeUser("viewer", "guest")]);
  const created = await db.project.create({ data: { name: `Shared ${tag}`, userId: owner.id, agents: [], tags: [] } });
  project = { id: created.id, userId: created.userId };
  await db.projectMember.createMany({ data: [
    { projectId: project.id, userId: guest.id, role: "editor" },
    { projectId: project.id, userId: otherGuest.id, role: "editor" },
    { projectId: project.id, userId: viewer.id, role: "viewer" },
  ] });
  roomId = (await db.chatRoom.create({ data: { name: "Planning", userId: owner.id, projectId: project.id, agentIds: [] } })).id;
});

beforeEach(async () => {
  await db.projectAgent.deleteMany({ where: { projectId: project.id } });
  await db.message.deleteMany({ where: { chatRoomId: roomId } });
});

describe("bringing an agent", () => {
  it("connects a guest's agent with nothing of the organization's granted to it", async () => {
    const { agent, token } = await bring(guest, "https://agent.example.com");
    const row = await db.projectAgent.findUniqueOrThrow({ where: { projectId_agentId: { projectId: project.id, agentId: agent.agentId } } });

    expect(row).toMatchObject({
      ownerUserId: guest.id, origin: "a2a", status: "connected", name: "Ledger Bot", protocolDialect: "1.0",
      agentCardUrl: "https://agent.example.com/.well-known/agent-card.json", endpointUrl: "https://agent.example.com/a2a",
      canReadProjectMemory: false, canWriteProjectMemory: false, canUseComputer: false,
    });
    expect(agent.agentId).toMatch(/^a2a-[0-9a-f]{16}$/);
    expect(agent).toMatchObject({ isYours: true, canManage: true, host: "agent.example.com" });
    // The token is derived on demand; a read of the row yields nothing usable.
    expect(token).toBe(projectAgentToken(row.id, row.tokenVersion));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("writes nothing when the agent's server does not answer with a card", async () => {
    const failing: OutsideTransport = async () => { throw new OutsideAgentError("The agent's server could not be reached.", "unreachable"); };
    await expect(bring(guest, "https://down.example.com", failing)).rejects.toBeInstanceOf(OutsideAgentError);
    await expect(bring(guest, "https://html.example.com", async () => "<html>")).rejects.toBeInstanceOf(OutsideAgentError);
    expect(await db.projectAgent.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("refuses a private address before any request is made", async () => {
    let called = false;
    const spy: OutsideTransport = async () => { called = true; return card(); };
    await expect(bring(guest, "https://169.254.169.254", spy)).rejects.toMatchObject({ code: "url_not_public" });
    await expect(bring(guest, "http://agent.example.com", spy)).rejects.toMatchObject({ code: "url_invalid" });
    expect(called).toBe(false);
  });

  it("refuses the same agent twice, and more than a person's share", async () => {
    await bring(guest, "https://one.example.com");
    await expectStatus(bring(otherGuest, "https://one.example.com"), 409);
    for (let i = 1; i < MAX_OUTSIDE_AGENTS_PER_PERSON; i += 1) await bring(guest);
    await expectStatus(bring(guest), 409);
    // The limit is per person: someone else still has room.
    await expect(bring(otherGuest)).resolves.toBeTruthy();
  });
});

describe("who may change an agent", () => {
  it("lets the project owner pause and remove a guest's agent, but not resume, re-key or re-check it", async () => {
    const { agent } = await bring(guest);
    const target = { project, agentId: agent.agentId, actorId: owner.id };

    await updateProjectAgent({ ...target, status: "disabled" });
    await expectStatus(updateProjectAgent({ ...target, status: "connected" }), 403);
    await expectStatus(updateProjectAgent({ ...target, canMessageOtherOwners: false }), 403);
    await expectStatus(rotateProjectAgentToken(target), 403);
    await expectStatus(recheckProjectAgent(target, cardOnly()), 403);

    await updateProjectAgent({ ...target, actorId: guest.id, status: "connected" });
    await removeProjectAgent(target);
    expect(await listProjectAgents(project, owner.id)).toEqual([]);
  });

  it("gives another guest no say over it, and hides what its server said", async () => {
    const { agent } = await bring(guest);
    await db.projectAgent.updateMany({ where: { agentId: agent.agentId }, data: { lastError: "connect ECONNREFUSED 203.0.113.9:443" } });
    const target = { project, agentId: agent.agentId, actorId: otherGuest.id };

    await expectStatus(updateProjectAgent({ ...target, status: "disabled" }), 403);
    await expectStatus(removeProjectAgent(target), 403);
    await expectStatus(removeProjectAgent({ ...target, agentId: "codex" }), 404);

    const [seenByOther] = await listProjectAgents(project, otherGuest.id);
    expect(seenByOther).toMatchObject({ isYours: false, canManage: false, lastError: "The last message to this agent was not answered." });
    expect((await listProjectAgents(project, guest.id))[0].lastError).toContain("ECONNREFUSED");
  });

  it("keeps a removed agent's row and ends its token", async () => {
    const { agent, token } = await bring(guest);
    await removeProjectAgent({ project, agentId: agent.agentId, actorId: guest.id });
    const row = await db.projectAgent.findUniqueOrThrow({ where: { projectId_agentId: { projectId: project.id, agentId: agent.agentId } } });
    expect(row.status).toBe("removed");
    expect(projectAgentToken(row.id, row.tokenVersion)).not.toBe(token);
    await expectStatus(updateProjectAgent({ project, agentId: agent.agentId, actorId: guest.id, status: "connected" }), 404);
  });

  it("issues a new token and picks up a moved agent on re-check", async () => {
    const { agent, token } = await bring(guest);
    const target = { project, agentId: agent.agentId, actorId: guest.id };
    expect(await rotateProjectAgentToken(target)).not.toBe(token);
    expect(await recheckProjectAgent(target, cardOnly("Ledger Bot 2"))).toEqual({ ok: true, error: null });
    expect((await listProjectAgents(project, guest.id))[0].name).toBe("Ledger Bot 2");
    const down = await recheckProjectAgent(target, async () => { throw new OutsideAgentError("The agent's server could not be reached.", "unreachable"); });
    expect(down.ok).toBe(false);
    expect((await listProjectAgents(project, guest.id))[0].lastError).toBe("The agent's server could not be reached.");
  });
});

describe("a turn for an outside agent", () => {
  const turn = (agentId: string, transport: OutsideTransport, userContent = "What is overdue?") =>
    runOutsideAgentReply({ roomId, projectId: project.id, agentId, userId: otherGuest.id, userContent }, transport);

  it("sends only the message addressed to it, with its own token, and posts the answer as the agent", async () => {
    const { agent, token } = await bring(guest);
    await db.message.create({ data: { chatRoomId: roomId, role: "user", content: "Confidential: the Q3 forecast is 4.1m", authorUserId: owner.id } });
    const sent: OutsideRequest[] = [];
    await turn(agent.agentId, async (request) => { sent.push(request); return { result: { message: { parts: [{ text: "Two invoices are overdue." }] } } }; });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://agent.example.com/a2a");
    expect(sent[0].headers).toMatchObject({ authorization: `Bearer ${token}` });
    const wire = JSON.stringify(sent[0].body);
    expect(wire).toContain("What is overdue?");
    expect(wire).not.toContain("Q3 forecast");
    expect(wire).not.toContain(project.id);

    const reply = (await roomMessages()).at(-1)!;
    expect(reply).toMatchObject({ role: "agent", agentId: agent.agentId, content: "Two invoices are overdue.", messageType: "ANSWER" });
    expect((await lastEvent()).type).toBe("agent.finished");
  });

  it("writes nothing in the agent's name when its server fails, and tells the room", async () => {
    const { agent } = await bring(guest);
    await turn(agent.agentId, async () => { throw new OutsideAgentError("The agent's server took too long to answer.", "timed_out", 504); });
    expect((await roomMessages()).map((m) => [m.role, m.agentId, m.content])).toEqual([
      ["system", null, "Ledger Bot did not answer. The agent's server took too long to answer."],
    ]);
    // The notice is nobody's words, so the room view that only knows people and agents leaves it out.
    expect((await getRoomSnapshot(roomId)).messages).toEqual([]);
    const event = await lastEvent();
    expect(event.type).toBe("agent.failed");
    expect(event.payload).toMatchObject({ agentId: agent.agentId, error: "The agent's server took too long to answer." });
    expect((await listProjectAgents(project, guest.id))[0].lastError).toBe("The agent's server took too long to answer.");
  });

  it("never calls a paused or removed agent, or one from another project", async () => {
    const { agent } = await bring(guest);
    let calls = 0;
    const spy: OutsideTransport = async () => { calls += 1; return { result: { message: { parts: [{ text: "hi" }] } } }; };

    await updateProjectAgent({ project, agentId: agent.agentId, actorId: owner.id, status: "disabled" });
    await turn(agent.agentId, spy);
    const elsewhere = await db.project.create({ data: { name: `Elsewhere ${tag}`, userId: owner.id, agents: [], tags: [] } });
    await runOutsideAgentReply({ roomId, projectId: elsewhere.id, agentId: agent.agentId, userId: owner.id, userContent: "hi" }, spy);
    await runOutsideAgentReply({ roomId, projectId: null, agentId: agent.agentId, userId: owner.id, userContent: "hi" }, spy);

    expect(calls).toBe(0);
    expect((await roomMessages()).filter((m) => m.role !== "system")).toEqual([]);
    expect((await lastEvent()).type).toBe("agent.failed");
  });
});

describe("end to end, against a real A2A server", () => {
  let server: Server;
  let base: string;
  const received: Array<{ auth: string | undefined; method: string; text: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const json = (body: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.url === "/.well-known/agent-card.json") {
        return json({ name: "Guest's Researcher", description: "Runs on the guest's machine.", supportedInterfaces: [{ url: `${base}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }] });
      }
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const rpc = JSON.parse(raw) as { id: string; method: string; params: { message: { parts: Array<{ text: string }> } } };
        const text = rpc.params.message.parts[0].text;
        received.push({ auth: req.headers.authorization, method: rpc.method, text });
        json({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: "task-1", status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ parts: [{ text: `You asked: ${text}` }] }] } } });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.PROJECT_AGENT_ALLOW_PRIVATE = "1";
  });
  afterAll(() => { delete process.env.PROJECT_AGENT_ALLOW_PRIVATE; server.closeAllConnections(); server.close(); });

  it("a guest brings an agent through the API and gets an answer from it in a shared room", async () => {
    const { POST, GET } = await import("@/app/api/projects/[id]/agents/route");
    const params = { params: Promise.resolve({ id: project.id }) };
    const post = (url: string) => POST(new NextRequest(`http://sentinel.test/api/projects/${project.id}/agents`, { method: "POST", body: JSON.stringify({ url, ownerUserId: owner.id, canUseComputer: true }) }), params);

    // A viewer may look but not bring; a stranger cannot even see the project.
    signedIn.user = viewer;
    expect((await post(base)).status).toBe(404);
    signedIn.user = await makeUser("stranger");
    expect((await GET(new NextRequest("http://sentinel.test/"), params)).status).toBe(404);

    signedIn.user = guest;
    const created = await post(base);
    expect(created.status).toBe(201);
    const { agent, token } = (await created.json()) as { agent: { agentId: string; name: string; owner: { id: string } }; token: string };
    // Extra fields in the body are ignored: the agent belongs to whoever is signed in, with no computer access.
    expect(agent.owner.id).toBe(guest.id);
    expect((await db.projectAgent.findFirstOrThrow({ where: { agentId: agent.agentId } })).canUseComputer).toBe(false);

    const participant = (await getRoomSnapshot(roomId)).participants.find((p) => p.agentId === agent.agentId);
    expect(participant).toMatchObject({ name: "Guest's Researcher", model: "not reported", status: "available", outside: { ownerName: "guest" } });

    await runCollaborationTurn({ chatRoomId: roomId, userId: guest.id, userContent: "Summarise the brief", recipientAgentIds: [agent.agentId] });

    expect(received).toEqual([{ auth: `Bearer ${token}`, method: "SendMessage", text: "Summarise the brief" }]);
    const messages = await roomMessages();
    expect(messages.map((m) => [m.role, m.agentId, m.authorUserId, m.content])).toEqual([
      ["user", null, guest.id, "Summarise the brief"],
      ["agent", agent.agentId, null, "You asked: Summarise the brief"],
    ]);
  });

  it("lets a guest ask it from the chat page, and names it in the transcript even after it is removed", async () => {
    const { agent } = await bringOutsideAgent({ project, ownerUserId: guest.id, url: base });
    const { POST, GET } = await import("@/app/api/rooms/[roomId]/messages/route");
    const params = { params: Promise.resolve({ roomId }) };
    const post = (body: unknown) => POST(new NextRequest(`http://sentinel.test/api/rooms/${roomId}/messages`, { method: "POST", body: JSON.stringify(body) }), params);

    signedIn.user = viewer; // may read the room, not write in it
    expect((await post({ content: "hello", toAgentId: agent.agentId })).status).toBe(404);
    signedIn.user = guest;
    expect((await post({ content: "hello", toAgentId: "codex" })).status).toBe(404); // not a way to reach Sentinel's agents
    expect((await post({ content: "hello", toAgentId: "a2a-0000000000000000" })).status).toBe(404);
    expect(await roomMessages()).toEqual([]);

    // A paused room asks no agent, and says so rather than recording the message as if it had.
    await db.chatRoom.update({ where: { id: roomId }, data: { paused: true } });
    received.length = 0;
    expect((await post({ content: "Any risks?", toAgentId: agent.agentId })).status).toBe(409);
    expect((await post({ content: "A note for people", })).status).toBe(201);
    await db.chatRoom.update({ where: { id: roomId }, data: { paused: false } });
    expect(received).toEqual([]);
    await db.message.deleteMany({ where: { chatRoomId: roomId } });

    expect((await post({ content: "Any risks?", toAgentId: agent.agentId })).status).toBe(201);
    await vi.waitFor(async () => expect((await roomMessages()).some((m) => m.agentId === agent.agentId)).toBe(true), { timeout: 10_000 });
    expect(received.map((r) => r.text)).toEqual(["Any risks?"]);

    await removeProjectAgent({ project, agentId: agent.agentId, actorId: guest.id });
    signedIn.user = owner;
    const transcript = (await (await GET(new NextRequest(`http://sentinel.test/api/rooms/${roomId}/messages`), params)).json()) as Array<{ role: string; agentName?: string; authorName?: string; mine: boolean }>;
    expect(transcript.map((m) => [m.role, m.agentName ?? m.authorName, m.mine])).toEqual([
      ["user", "guest", false],
      ["agent", "Guest's Researcher (guest's agent)", false],
    ]);
  });

  it("pauses a person's agents when they are taken off the project", async () => {
    const { agent } = await bringOutsideAgent({ project, ownerUserId: guest.id, url: base });
    const membership = await db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: project.id, userId: guest.id } } });
    const { DELETE } = await import("@/app/api/projects/[id]/members/route");
    signedIn.user = owner;
    const res = await DELETE(new NextRequest(`http://sentinel.test/api/projects/${project.id}/members?memberId=${membership.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: project.id }) });
    expect(res.status).toBe(200);

    expect((await db.projectAgent.findFirstOrThrow({ where: { agentId: agent.agentId } })).status).toBe("disabled");
    received.length = 0;
    await runCollaborationTurn({ chatRoomId: roomId, userId: owner.id, userContent: "Still there?", recipientAgentIds: [agent.agentId] });
    expect(received).toEqual([]);
    expect((await lastEvent()).type).toBe("agent.failed");
  });
});
