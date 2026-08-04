import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { GET as getRuntime } from "@/app/api/agent-runtimes/[id]/route";
import {
  GET as listRuntimeSessions,
  POST as startRuntimeSession,
} from "@/app/api/agent-runtimes/[id]/sessions/route";
import { POST as restartRuntime } from "@/app/api/agent-runtimes/[id]/restart/route";
import { POST as reloadRuntime } from "@/app/api/agent-runtimes/[id]/reload/route";
import { GET as getSession } from "@/app/api/agent-sessions/[sessionId]/route";
import { POST as cancelSession } from "@/app/api/agent-sessions/[sessionId]/cancel/route";
import { POST as resumeSession } from "@/app/api/agent-sessions/[sessionId]/resume/route";
import { GET as getSessionEvents } from "@/app/api/agent-sessions/[sessionId]/events/route";
import { GET as getSessionLogs } from "@/app/api/agent-sessions/[sessionId]/logs/route";
import { POST as delegateSession } from "@/app/api/agent-sessions/[sessionId]/delegate/route";
import { makeUser, makeWorkspace, uid } from "../neural-engine/db-setup";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUser: auth.requireUser }));

beforeEach(() => auth.requireUser.mockReset());
afterAll(async () => db.$disconnect());

async function assignRuntime(runtimeId: string, workspaceId: string) {
  return db.agentRuntime.update({ where: { id: runtimeId }, data: { workspaceId } });
}

async function makeSession(input: {
  runtimeId: string;
  runtime: string;
  agentId: string;
  userId: string;
  workspaceId: string;
  status?: string;
  externalSessionId?: string;
}) {
  return db.agentSession.create({
    data: {
      runtime: input.runtime,
      runtimeInstanceId: input.runtimeId,
      agentId: input.agentId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      status: input.status ?? "ready",
      externalSessionId: input.externalSessionId,
    },
  });
}

describe("release audit — runtime and session API tenant boundaries", () => {
  it("rejects forged runtime, workspace, and target-agent identifiers", async () => {
    const owner = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Runtime identifier owner");
    const otherWorkspace = await makeWorkspace(owner.id, "Forged runtime workspace");
    await assignRuntime("runtime-codex", workspace.id);
    auth.requireUser.mockResolvedValue(owner);

    const missingRuntime = await getRuntime(new Request("http://localhost/api/agent-runtimes/forged"), {
      params: Promise.resolve({ id: uid("forged-runtime") }),
    });
    expect(missingRuntime.status).toBe(404);

    const forgedWorkspace = await startRuntimeSession(
      new Request("http://localhost/api/agent-runtimes/runtime-codex/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: otherWorkspace.id }),
      }),
      { params: Promise.resolve({ id: "runtime-codex" }) },
    );
    expect(forgedWorkspace.status).toBe(403);

    const source = await makeSession({
      runtimeId: "runtime-codex",
      runtime: "codex",
      agentId: "codex",
      userId: owner.id,
      workspaceId: workspace.id,
    });
    const forgedAgent = await delegateSession(
      new Request(`http://localhost/api/agent-sessions/${source.id}/delegate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetAgentId: uid("forged-agent"), reason: "security test" }),
      }),
      { params: Promise.resolve({ sessionId: source.id }) },
    );
    expect(forgedAgent.status).toBe(404);
  });

  it("blocks cross-tenant GET, cancel, resume, events, and logs without opening a stream", async () => {
    const tenantAUser = await makeUser();
    const tenantBUser = await makeUser();
    await makeWorkspace(tenantAUser.id, "Runtime tenant A");
    const workspaceB = await makeWorkspace(tenantBUser.id, "Runtime tenant B");
    await assignRuntime("runtime-claude-code", workspaceB.id);
    const session = await makeSession({
      runtimeId: "runtime-claude-code",
      runtime: "claude-code",
      agentId: "claude-code",
      userId: tenantBUser.id,
      workspaceId: workspaceB.id,
      externalSessionId: uid("provider-session"),
    });
    auth.requireUser.mockResolvedValue(tenantAUser);
    const context = { params: Promise.resolve({ sessionId: session.id }) };

    const responses = await Promise.all([
      getSession(new Request(`http://localhost/api/agent-sessions/${session.id}`), context),
      cancelSession(new Request(`http://localhost/api/agent-sessions/${session.id}/cancel`, { method: "POST" }), context),
      resumeSession(new Request(`http://localhost/api/agent-sessions/${session.id}/resume`, { method: "POST" }), context),
      getSessionEvents(new Request(`http://localhost/api/agent-sessions/${session.id}/events`), context),
      getSessionLogs(new Request(`http://localhost/api/agent-sessions/${session.id}/logs`), context),
    ]);

    for (const response of responses) {
      expect([403, 404]).toContain(response.status);
      expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    }
  });

  it("does not enumerate another user's sessions through an authorized workspace runtime", async () => {
    const owner = await makeUser();
    const otherUser = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Runtime enumeration tenant");
    await assignRuntime("runtime-openclaw", workspace.id);
    const privateSession = await makeSession({
      runtimeId: "runtime-openclaw",
      runtime: "openclaw",
      agentId: "openclaw",
      userId: otherUser.id,
      workspaceId: workspace.id,
    });
    auth.requireUser.mockResolvedValue(owner);

    const response = await listRuntimeSessions(
      new Request("http://localhost/api/agent-runtimes/runtime-openclaw/sessions"),
      { params: Promise.resolve({ id: "runtime-openclaw" }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessions.map((session: { id: string }) => session.id)).not.toContain(privateSession.id);
  });

  it("resumes SSE strictly after Last-Event-ID and emits an id for every event", async () => {
    const owner = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Runtime SSE tenant");
    await assignRuntime("runtime-hermes-lisa", workspace.id);
    const session = await makeSession({
      runtimeId: "runtime-hermes-lisa",
      runtime: "hermes",
      agentId: "hermes-lisa",
      userId: owner.id,
      workspaceId: workspace.id,
      status: "completed",
    });
    await db.agentRuntimeEvent.createMany({
      data: [1, 2, 3].map((sequence) => ({
        sessionId: session.id,
        sequence,
        type: sequence === 3 ? "completed" : "stdout",
        payload: { sequence },
      })),
    });
    auth.requireUser.mockResolvedValue(owner);

    const response = await getSessionEvents(
      new Request(`http://localhost/api/agent-sessions/${session.id}/events`, {
        headers: { "Last-Event-ID": "2" },
      }),
      { params: Promise.resolve({ sessionId: session.id }) },
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("id: 3\n");
    expect(body).not.toContain("id: 1\n");
    expect(body).not.toContain("id: 2\n");
  });

  it("rejects restart and reload when a workspace member lacks the server-side permission", async () => {
    const owner = await makeUser();
    const operator = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Runtime restart tenant");
    await assignRuntime("runtime-hermes-lisa", workspace.id);
    const viewPermission = await db.permission.create({
      data: {
        workspaceId: workspace.id,
        key: RUNTIME_PERMISSIONS.view,
        resource: "agents.runtime",
        action: "view",
      },
    });
    const role = await db.role.create({
      data: {
        workspaceId: workspace.id,
        name: uid("runtime-viewer"),
        permissions: { connect: { id: viewPermission.id } },
      },
    });
    await db.roleAssignment.create({
      data: { workspaceId: workspace.id, roleId: role.id, userId: operator.id },
    });
    auth.requireUser.mockResolvedValue(operator);

    const context = { params: Promise.resolve({ id: "runtime-hermes-lisa" }) };
    const [restart, reload] = await Promise.all([
      restartRuntime(new Request("http://localhost/api/agent-runtimes/runtime-hermes-lisa/restart", { method: "POST" }), context),
      reloadRuntime(new Request("http://localhost/api/agent-runtimes/runtime-hermes-lisa/reload", { method: "POST" }), context),
    ]);
    expect(restart.status).toBe(403);
    expect(reload.status).toBe(403);
  });
});
