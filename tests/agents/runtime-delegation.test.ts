import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { delegateSession } from "@/lib/agents/runtime/delegation";
import { deriveOperationalState } from "@/lib/agents/runtime/status";
import type { AgentSession, RuntimeHealth } from "@/lib/agents/runtime/types";
import { makeAgent, makeUser, makeWorkspace, uid } from "../neural-engine/db-setup";

afterAll(async () => db.$disconnect());

function health(overrides: Partial<RuntimeHealth> = {}): RuntimeHealth {
  return {
    installed: true,
    processRunning: false,
    reachable: true,
    authenticated: true,
    ready: true,
    busy: false,
    degraded: false,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function session(status: AgentSession["status"]): AgentSession {
  const now = new Date().toISOString();
  return {
    id: "session",
    runtime: "codex",
    runtimeInstanceId: "runtime",
    agentId: "agent",
    userId: "user",
    status,
    startedAt: now,
    lastActivityAt: now,
    metadata: {},
  };
}

describe("runtime operational state", () => {
  it("distinguishes streaming, degraded, idle, and offline from observable state", () => {
    expect(deriveOperationalState({ health: health({ busy: true }), currentSession: session("running"), latestEventType: "assistant_delta" })).toBe("streaming");
    expect(deriveOperationalState({ health: health({ ready: false, degraded: true }), currentSession: null, latestEventType: null })).toBe("error");
    expect(deriveOperationalState({ health: health(), currentSession: session("ready"), latestEventType: "session_started" })).toBe("idle");
    expect(deriveOperationalState({ health: health({ installed: false, reachable: false, processRunning: false, ready: false }), currentSession: null, latestEventType: null })).toBe("offline");
  });
});

describe("delegateSession", () => {
  it("creates a same-workspace target session with lineage, events, and an audit record", async () => {
    const owner = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Delegation workspace");
    const sourceAgent = await makeAgent("Source agent");
    const targetAgent = await makeAgent("Target agent");
    await db.agent.updateMany({
      where: { id: { in: [sourceAgent.id, targetAgent.id] } },
      data: { workspaceId: workspace.id },
    });
    const sourceRuntime = await db.agentRuntime.create({
      data: { id: uid("source-runtime"), agentId: sourceAgent.id, kind: "codex", transport: "process", workspaceId: workspace.id },
    });
    const targetRuntime = await db.agentRuntime.create({
      data: { id: uid("target-runtime"), agentId: targetAgent.id, kind: "claude-code", transport: "process", workspaceId: workspace.id },
    });
    const source = await db.agentSession.create({
      data: {
        runtime: "codex",
        runtimeInstanceId: sourceRuntime.id,
        agentId: sourceAgent.id,
        userId: owner.id,
        workspaceId: workspace.id,
        status: "running",
      },
    });
    await db.agentRuntimeEvent.create({
      data: { sessionId: source.id, sequence: 1, type: "status", payload: { phase: "working" } },
    });

    const delegated = await delegateSession({
      sourceSessionId: source.id,
      targetAgentId: targetAgent.id,
      actorUserId: owner.id,
      reason: "Target agent owns the deployment review.",
      context: { artifact: "release-candidate" },
    });

    expect(delegated).toMatchObject({
      runtimeInstanceId: targetRuntime.id,
      agentId: targetAgent.id,
      workspaceId: workspace.id,
      parentSessionId: source.id,
      status: "ready",
    });
    const [sourceEvents, targetEvents, audit] = await Promise.all([
      db.agentRuntimeEvent.findMany({ where: { sessionId: source.id }, orderBy: { sequence: "asc" } }),
      db.agentRuntimeEvent.findMany({ where: { sessionId: delegated.id } }),
      db.auditLog.findFirst({ where: { action: "agent_runtime.session_delegated", entityId: delegated.id } }),
    ]);
    expect(sourceEvents.map((event) => event.type)).toEqual(["status", "delegated"]);
    expect(targetEvents).toHaveLength(1);
    expect(targetEvents[0]).toMatchObject({ type: "delegated", sequence: 1 });
    expect(audit).toMatchObject({ workspaceId: workspace.id, userId: owner.id, entityType: "AgentSession" });
  });

  it("fails closed when the target agent belongs to another workspace", async () => {
    const owner = await makeUser();
    const otherOwner = await makeUser();
    const sourceWorkspace = await makeWorkspace(owner.id, "Source workspace");
    const targetWorkspace = await makeWorkspace(otherOwner.id, "Target workspace");
    const sourceAgent = await makeAgent("Source tenant agent");
    const targetAgent = await makeAgent("Other tenant agent");
    await db.agent.update({ where: { id: sourceAgent.id }, data: { workspaceId: sourceWorkspace.id } });
    await db.agent.update({ where: { id: targetAgent.id }, data: { workspaceId: targetWorkspace.id } });
    const sourceRuntime = await db.agentRuntime.create({
      data: { id: uid("tenant-source-runtime"), agentId: sourceAgent.id, kind: "codex", transport: "process", workspaceId: sourceWorkspace.id },
    });
    await db.agentRuntime.create({
      data: { id: uid("tenant-target-runtime"), agentId: targetAgent.id, kind: "claude-code", transport: "process", workspaceId: targetWorkspace.id },
    });
    const source = await db.agentSession.create({
      data: {
        runtime: "codex",
        runtimeInstanceId: sourceRuntime.id,
        agentId: sourceAgent.id,
        userId: owner.id,
        workspaceId: sourceWorkspace.id,
      },
    });

    await expect(delegateSession({
      sourceSessionId: source.id,
      targetAgentId: targetAgent.id,
      actorUserId: owner.id,
      reason: "Attempt cross-tenant handoff",
    })).rejects.toMatchObject({ code: "workspace_mismatch", status: 403 });
  });
});
