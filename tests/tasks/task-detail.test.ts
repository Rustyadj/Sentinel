// Task detail: who may see a task, and what the browser is handed.
// Written to fail in both directions: a task shown to someone outside its scope,
// and a legitimate member who cannot see their own workspace's task.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canReadTask, getTaskDetail } from "@/lib/tasks/detail";
import { ensureSystemRoles, ensureMemberAccess } from "@/lib/workspaces/permissions-catalog";

const P = `td-${Date.now().toString(36)}`;
const ids = {
  owner: `${P}-owner`, member: `${P}-member`, outsider: `${P}-outsider`, roomOwner: `${P}-roomowner`,
  wsA: `${P}-ws-a`, wsB: `${P}-ws-b`, projectOnly: `${P}-proj`, room: `${P}-room`,
  taskWs: `${P}-task-ws`, taskProject: `${P}-task-proj`, taskRoom: `${P}-task-room`, taskNone: `${P}-task-none`, taskOtherWs: `${P}-task-wsb`,
};
const allUsers = [ids.owner, ids.member, ids.outsider, ids.roomOwner];

beforeAll(async () => {
  for (const id of allUsers) await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.workspace.create({ data: { id: ids.wsA, slug: ids.wsA, name: "A", ownerId: ids.owner } });
  await db.workspace.create({ data: { id: ids.wsB, slug: ids.wsB, name: "B", ownerId: ids.outsider } });
  await ensureSystemRoles(ids.wsA);
  await ensureMemberAccess(ids.wsA, ids.member);
  await db.project.create({ data: { id: ids.projectOnly, name: "Solo", userId: ids.owner, workspaceId: null } });
  await db.chatRoom.create({ data: { id: ids.room, name: "room", userId: ids.roomOwner } as never });
  const task = (id: string, over: Record<string, unknown>) => db.task.create({ data: { id, title: `Task ${id}`, status: "TODO", priority: "medium", ...over } as never });
  await task(ids.taskWs, { workspaceId: ids.wsA, chatRoomId: ids.room, worktreePath: "/tmp/wt" });
  await task(ids.taskProject, { projectId: ids.projectOnly });
  await task(ids.taskRoom, { chatRoomId: ids.room });
  await task(ids.taskNone, {});
  await task(ids.taskOtherWs, { workspaceId: ids.wsB });
  // Things the page must show names of, and things it must never ship to the browser.
  await db.approvalRequest.create({ data: { workspaceId: ids.wsA, taskId: ids.taskWs, type: "tool_call", title: "Approve deploy", requesterUserId: ids.owner, payload: { secretToken: "sk-should-never-reach-the-browser" } } as never });
});

afterAll(async () => {
  await db.approvalRequest.deleteMany({ where: { taskId: ids.taskWs } });
  await db.task.deleteMany({ where: { id: { in: [ids.taskWs, ids.taskProject, ids.taskRoom, ids.taskNone, ids.taskOtherWs] } } });
  await db.chatRoom.deleteMany({ where: { id: ids.room } });
  await db.project.deleteMany({ where: { id: ids.projectOnly } });
  await db.roleAssignment.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
  await db.role.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
  await db.permission.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
  await db.workspace.deleteMany({ where: { id: { in: [ids.wsA, ids.wsB] } } });
  await db.user.deleteMany({ where: { id: { in: allUsers } } });
});

const view = (taskId: string, viewer: string) => getTaskDetail(taskId, viewer, { canViewSession: async () => true });

describe("who can open a task", () => {
  it("a workspace owner and a workspace member can; a user outside the workspace cannot", async () => {
    expect((await view(ids.taskWs, ids.owner))?.task.title).toBe(`Task ${ids.taskWs}`);
    expect(await view(ids.taskWs, ids.member)).not.toBeNull();
    expect(await view(ids.taskWs, ids.outsider)).toBeNull();
    expect(await view(ids.taskWs, ids.roomOwner)).toBeNull(); // owning the chat room does not bypass the workspace
  });

  it("workspaces are isolated from each other", async () => {
    expect(await view(ids.taskOtherWs, ids.owner)).toBeNull();
    expect(await view(ids.taskOtherWs, ids.member)).toBeNull();
    expect(await view(ids.taskOtherWs, ids.outsider)).not.toBeNull();
  });

  it("a project-only task is readable by the project's owner and nobody else", async () => {
    expect(await view(ids.taskProject, ids.owner)).not.toBeNull();
    expect(await view(ids.taskProject, ids.member)).toBeNull();
    expect(await view(ids.taskProject, ids.outsider)).toBeNull();
  });

  it("a room-only task belongs to the room's owner", async () => {
    expect(await view(ids.taskRoom, ids.roomOwner)).not.toBeNull();
    expect(await view(ids.taskRoom, ids.owner)).toBeNull();
  });

  it("a task with no scope, or no such task, is visible to nobody", async () => {
    expect(await view(ids.taskNone, ids.owner)).toBeNull();
    expect(await view("does-not-exist", ids.owner)).toBeNull();
    expect(await canReadTask(ids.owner, { workspaceId: null, projectId: null, chatRoomId: null })).toBe(false);
  });
});

describe("what the browser is handed", () => {
  it("carries only rendered fields — no approval payloads or other row internals", async () => {
    const detail = await view(ids.taskWs, ids.owner);
    expect(detail?.approvals).toEqual([{ id: expect.any(String), title: "Approve deploy", status: "pending" }]);
    expect(JSON.stringify(detail)).not.toContain("sk-should-never-reach-the-browser");
    expect(Object.keys(detail!.task).sort()).toEqual([
      "agentId", "baseBranch", "branch", "chatRoomId", "createdByAgentId", "description", "id", "priority", "project",
      "projectId", "reviewerAgentId", "status", "title", "workspace", "workspaceId", "worktreePath",
    ]);
  });

  it("hands over the live session id only to a viewer who may open its event stream", async () => {
    const runtime = await db.agentRuntime.create({ data: { agentId: "hermes-lisa", kind: "hermes", transport: "http", workspaceId: ids.wsA } });
    const session = await db.agentSession.create({ data: {
      runtime: "hermes", runtimeInstanceId: runtime.id, agentId: "hermes-lisa", userId: ids.owner, workspaceId: ids.wsA,
      chatRoomId: ids.room, workingDirectory: "/tmp/wt", status: "running",
    } });
    try {
      expect((await getTaskDetail(ids.taskWs, ids.owner, { canViewSession: async () => true }))?.liveSessionId).toBe(session.id);
      expect((await getTaskDetail(ids.taskWs, ids.owner, { canViewSession: async () => false }))?.liveSessionId).toBeNull();
      await db.agentSession.update({ where: { id: session.id }, data: { status: "completed" } });
      expect((await getTaskDetail(ids.taskWs, ids.owner, { canViewSession: async () => true }))?.liveSessionId).toBeNull();
    } finally {
      await db.agentSession.deleteMany({ where: { id: session.id } });
      await db.agentRuntime.deleteMany({ where: { id: runtime.id } });
    }
  });
});
