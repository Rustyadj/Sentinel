// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as register } from "@/app/api/auth/register/route";
import { resetMemoryRateLimits } from "@/lib/auth/rate-limit";
import { requireRoomAccess } from "@/lib/orchestration/access";
import { guestMayReach } from "@/lib/people/guest-gate";
import {
  acceptInvitation, createInvitation, describeInvitation, hashInvitationToken, InvitationError, revokeInvitation,
} from "@/lib/people/invitations";
import { ensureHomeOrganization, getOrgRole, removeOrgMember } from "@/lib/people/organization";
import { userCanOnProject } from "@/lib/people/project-access";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { listWorkspaces } from "@/lib/workspaces/objects";

// Invitations decide who gets an account and what it can reach, so these run
// against a real database: the rules live in queries and unique constraints,
// and a mocked client would only test the mocks.

const tag = randomUUID().slice(0, 8);
const mail = (name: string) => `${name}-${tag}@people.test`;
const makeUser = (name: string, accessScope = "member") =>
  db.user.create({ data: { email: mail(name), name, accessScope } });

let owner: Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
let projectId: string;
let roomId: string;
let runtimeWorkspaceId: string;

async function expectInvitationError(run: Promise<unknown>, status: number) {
  const error = await run.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(InvitationError);
  expect((error as InvitationError).status).toBe(status);
}

beforeAll(async () => {
  owner = await makeUser("owner");
  const org = await ensureHomeOrganization();
  orgId = org.id;
  // Whoever the seeded database made the owner, this suite's owner manages people too.
  await db.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: orgId, userId: owner.id } },
    update: { role: "admin" },
    create: { organizationId: orgId, userId: owner.id, role: "admin" },
  });
  // A workspace of the organization's, standing in for the one agent runtimes live in.
  const workspace = await db.workspace.create({
    data: { slug: `runtimes-${tag}`, name: "Runtimes", ownerId: owner.id, organizationId: orgId },
  });
  runtimeWorkspaceId = workspace.id;
  const project = await db.project.create({ data: { name: `Bridge ${tag}`, userId: owner.id, agents: [], tags: [] } });
  projectId = project.id;
  const room = await db.chatRoom.create({ data: { name: "Planning", userId: owner.id, projectId, agentIds: [] } });
  roomId = room.id;
});

describe("creating invitations", () => {
  it("stores only the hash of the token", async () => {
    const { invitation, token } = await createInvitation({ scope: "organization", role: "member" }, owner.id);
    expect(invitation.tokenHash).toBe(hashInvitationToken(token));
    expect(JSON.stringify(invitation)).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("refuses a team invitation from someone who does not manage people", async () => {
    const member = await makeUser("plain-member");
    await db.organizationMember.create({ data: { organizationId: orgId, userId: member.id, role: "member" } });
    await expectInvitationError(createInvitation({ scope: "organization", role: "admin" }, member.id), 403);
  });

  it("never hands out ownership by link", async () => {
    await expectInvitationError(createInvitation({ scope: "organization", role: "owner" }, owner.id), 400);
  });

  it("does not let a guest invite anyone, even to a project of their own", async () => {
    const guest = await makeUser("guest-inviter", "guest");
    const own = await db.project.create({ data: { name: `Guest's own ${tag}`, userId: guest.id, agents: [], tags: [] } });
    await expectInvitationError(createInvitation({ scope: "project", role: "editor", projectId: own.id }, guest.id), 403);
  });

  it("hides a project the inviter cannot share", async () => {
    const stranger = await makeUser("stranger");
    await expectInvitationError(createInvitation({ scope: "project", role: "editor", projectId }, stranger.id), 404);
  });
});

describe("accepting a team invitation", () => {
  it("makes an operator who can run agents, exactly once", async () => {
    const invitee = await makeUser("operator", "guest");
    const { token } = await createInvitation({ scope: "organization", role: "operator" }, owner.id);

    expect(await userHasWorkspacePermission(invitee.id, runtimeWorkspaceId, "agents.runtime.execute")).toBe(false);
    await acceptInvitation(token, invitee);

    expect(await getOrgRole(invitee.id)).toBe("operator");
    expect((await db.user.findUniqueOrThrow({ where: { id: invitee.id } })).accessScope).toBe("member");
    expect(await userHasWorkspacePermission(invitee.id, runtimeWorkspaceId, "agents.runtime.execute")).toBe(true);
    expect(await userHasWorkspacePermission(invitee.id, runtimeWorkspaceId, "permission.manage")).toBe(false);

    const second = await makeUser("second-taker");
    await expectInvitationError(acceptInvitation(token, second), 410);
    expect(await getOrgRole(second.id)).toBeNull();
  });

  it("a member cannot run agents", async () => {
    const invitee = await makeUser("member-only");
    const { token } = await createInvitation({ scope: "organization", role: "member" }, owner.id);
    await acceptInvitation(token, invitee);
    expect(await getOrgRole(invitee.id)).toBe("member");
    expect(await userHasWorkspacePermission(invitee.id, runtimeWorkspaceId, "agents.runtime.execute")).toBe(false);
  });

  it("admits only the address it was issued to", async () => {
    const intended = await makeUser("intended");
    const other = await makeUser("other");
    const { token } = await createInvitation({ scope: "organization", role: "member", email: intended.email.toUpperCase() }, owner.id);
    await expectInvitationError(acceptInvitation(token, other), 403);
    await acceptInvitation(token, intended); // case-insensitive, and still unspent after the refusal
    expect(await getOrgRole(intended.id)).toBe("member");
  });

  it("rejects expired, withdrawn and made-up links", async () => {
    const someone = await makeUser("late");
    const expired = await createInvitation({ scope: "organization", role: "member" }, owner.id);
    await db.invitation.update({ where: { id: expired.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectInvitationError(acceptInvitation(expired.token, someone), 410);

    const withdrawn = await createInvitation({ scope: "organization", role: "member" }, owner.id);
    await revokeInvitation(withdrawn.invitation.id, owner.id);
    await expectInvitationError(describeInvitation(withdrawn.token), 410);

    await expectInvitationError(acceptInvitation("not-a-real-token-but-long-enough-to-look-up", someone), 404);
    expect(await getOrgRole(someone.id)).toBeNull();
  });

  it("removal sticks: the account is not quietly re-enrolled", async () => {
    const invitee = await makeUser("leaver");
    const { token } = await createInvitation({ scope: "organization", role: "operator" }, owner.id);
    await acceptInvitation(token, invitee);
    await removeOrgMember({ userId: invitee.id, actorId: owner.id });

    expect(await getOrgRole(invitee.id)).toBeNull();
    expect(await userHasWorkspacePermission(invitee.id, runtimeWorkspaceId, "agents.runtime.execute")).toBe(false);
    // Listing workspaces is what used to enrol every account in the shared ones.
    const visible = await listWorkspaces(invitee.id);
    expect(visible).toEqual([]);
  });
});

describe("a project guest", () => {
  it("reaches the one project and nothing else", async () => {
    const guest = await makeUser("guest-editor", "guest");
    const { token } = await createInvitation({ scope: "project", role: "editor", projectId }, owner.id);
    await acceptInvitation(token, guest);

    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, userId: true, workspaceId: true } });
    expect(await userCanOnProject(guest.id, project, "project.read")).toBe(true);
    expect(await userCanOnProject(guest.id, project, "task.create")).toBe(true);
    expect(await userCanOnProject(guest.id, project, "project.delete")).toBe(false);
    expect(await userCanOnProject(guest.id, project, "agents.runtime.execute")).toBe(false);

    expect(await getOrgRole(guest.id)).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: guest.id } })).accessScope).toBe("guest");
    expect(await listWorkspaces(guest.id)).toEqual([]);
    expect(await db.roleAssignment.count({ where: { userId: guest.id } })).toBe(0);

    // The project's room, but not a private room of the same owner.
    expect((await requireRoomAccess(roomId, guest.id, "write")).id).toBe(roomId);
    const privateRoom = await db.chatRoom.create({ data: { name: "Private", userId: owner.id, agentIds: [] } });
    await expect(requireRoomAccess(privateRoom.id, guest.id, "read")).rejects.toThrow("Room not found");
  });

  it("a viewer can follow a room but not write in it", async () => {
    const viewer = await makeUser("guest-viewer", "guest");
    const { token } = await createInvitation({ scope: "project", role: "viewer", projectId }, owner.id);
    await acceptInvitation(token, viewer);
    expect((await requireRoomAccess(roomId, viewer.id, "read")).id).toBe(roomId);
    await expect(requireRoomAccess(roomId, viewer.id, "write")).rejects.toThrow("Room not found");
  });

  it("is fenced to project surfaces at the proxy", () => {
    expect(guestMayReach("/projects", "GET")).toBe(true);
    expect(guestMayReach("/chat", "GET")).toBe(true);
    expect(guestMayReach("/api/projects/abc/members", "GET")).toBe(true);
    expect(guestMayReach("/api/invitations/accept", "POST")).toBe(true);
    for (const path of ["/settings", "/agents", "/control", "/security", "/projectsx", "/api/agents", "/api/vps/agents",
      "/api/invitations", "/api/learning/settings", "/api/integrations/oauth/authorize", "/api/control-plane", "/api/peoplex"]) {
      expect(guestMayReach(path, "GET"), path).toBe(false);
    }
    expect(guestMayReach("/api/people/someone", "DELETE")).toBe(false);
    expect(guestMayReach("/api/workspaces", "POST")).toBe(false);
  });
});

describe("registering with an invitation", () => {
  const post = (body: Record<string, unknown>) =>
    // Its own client address: registration is rate limited per address, and
    // other suites register from the default one at the same time.
    register(new Request("http://sentinel.test/api/auth/register", {
      method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `10.9.${tag.charCodeAt(0) % 250}.${tag.charCodeAt(1) % 250}` },
    }));

  it("admits a new account past the closed signup policy, as a guest of the project", async () => {
    resetMemoryRateLimits();
    const email = mail("newcomer");
    const closed = await post({ email, password: "correct horse battery" });
    expect(closed.status).toBe(403);

    const { token } = await createInvitation({ scope: "project", role: "editor", projectId }, owner.id);
    const response = await post({ email, password: "correct horse battery", inviteToken: token });
    expect(response.status).toBe(201);

    const created = await db.user.findUniqueOrThrow({ where: { email } });
    expect(created.accessScope).toBe("guest");
    expect(await db.projectMember.count({ where: { projectId, userId: created.id, role: "editor" } })).toBe(1);

    // The link is spent: it cannot admit a second account.
    const again = await post({ email: mail("freeloader"), password: "correct horse battery", inviteToken: token });
    expect(again.status).toBe(410);
    expect(await db.user.count({ where: { email: mail("freeloader") } })).toBe(0);
  });

  it("does not admit a different address than the invitation names", async () => {
    resetMemoryRateLimits();
    const { token } = await createInvitation({ scope: "organization", role: "member", email: mail("named") }, owner.id);
    const response = await post({ email: mail("impostor"), password: "correct horse battery", inviteToken: token });
    expect(response.status).toBe(403);
    expect(await db.user.count({ where: { email: mail("impostor") } })).toBe(0);
  });
});
