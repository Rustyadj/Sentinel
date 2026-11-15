// Agents people bring into a shared project. This slice covers one kind: an
// agent that runs on its owner's own server and is reached over A2A
// (origin "a2a"). Sentinel does not run it, choose its model, or lend it any
// of this organization's compute, credentials, memory or computers.
//
// Who may do what:
//   bring one        anyone who may write to the project (owner, editor, or a
//                    workspace role with project.update). Viewers may not.
//   pause / remove   the agent's owner, or whoever manages the project.
//   resume, re-key,  the agent's owner only: turning an agent back on, or
//   re-check, edit   changing what it may do, is theirs to decide.

import { randomBytes } from "node:crypto";
import type { ProjectAgent } from "@prisma/client";
import { db } from "@/lib/db";
import { userCanShareProject } from "@/lib/people/project-access";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { agentCardUrl, fetchAgentCard } from "./a2a/client";
import { requestOutsideJson, type OutsideTransport } from "./a2a/http";
import { projectAgentToken } from "./agent-token";

export const OUTSIDE_ORIGIN = "a2a";
const OUTSIDE_ID_PREFIX = "a2a-";
/** Enough for a person's own agents; small enough that a project cannot be flooded by one account. */
export const MAX_OUTSIDE_AGENTS_PER_PERSON = 5;

/** Ids of outside agents can never collide with the registry's (src/lib/agents/registry.ts). */
export const isOutsideAgentId = (agentId: string) => agentId.startsWith(OUTSIDE_ID_PREFIX);

export class ProjectAgentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProjectAgentError";
  }
}

type ProjectRef = { id: string; userId: string };

export interface ProjectAgentView {
  agentId: string;
  name: string;
  description: string;
  origin: string;
  status: string;
  owner: { id: string; name: string };
  isYours: boolean;
  /** Pause or remove. */
  canManage: boolean;
  canMessageOtherOwners: boolean;
  /** Host only, never the full address: enough to recognise, nothing to call. */
  host: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const hostOf = (url: string | null) => {
  try { return url ? new URL(url).host : null; } catch { return null; }
};

function toView(row: ProjectAgent & { owner: { id: string; name: string | null } }, viewerId: string, viewerManagesProject: boolean): ProjectAgentView {
  const isYours = row.ownerUserId === viewerId;
  return {
    agentId: row.agentId,
    name: row.name ?? row.agentId,
    description: row.description ?? "",
    origin: row.origin,
    status: row.status,
    owner: { id: row.owner.id, name: row.owner.name ?? "Member" },
    isYours,
    canManage: isYours || viewerManagesProject,
    canMessageOtherOwners: row.canMessageOtherOwners,
    host: hostOf(row.endpointUrl),
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    // The reason a call failed can describe the owner's server; it is theirs to see.
    lastError: isYours ? row.lastError : row.lastError ? "The last message to this agent was not answered." : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjectAgents(project: ProjectRef, viewerId: string): Promise<ProjectAgentView[]> {
  const [rows, manages] = await Promise.all([
    db.projectAgent.findMany({
      where: { projectId: project.id, status: { not: "removed" } },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    userCanShareProject(viewerId, project),
  ]);
  return rows.map((row) => toView(row, viewerId, manages));
}

/**
 * Connects an agent by its Agent Card. The card is fetched before anything is
 * written, so a row only exists for an agent that answered. Returns the token
 * its server must accept; this is the only time the caller is handed it
 * without asking again.
 */
export async function bringOutsideAgent(
  input: { project: ProjectRef; ownerUserId: string; url: string },
  transport: OutsideTransport = requestOutsideJson,
): Promise<{ agent: ProjectAgentView; token: string }> {
  const cardUrl = agentCardUrl(input.url);
  const held = await db.projectAgent.count({ where: { projectId: input.project.id, ownerUserId: input.ownerUserId, origin: OUTSIDE_ORIGIN, status: { not: "removed" } } });
  if (held >= MAX_OUTSIDE_AGENTS_PER_PERSON) {
    throw new ProjectAgentError(`You already have ${MAX_OUTSIDE_AGENTS_PER_PERSON} agents on this project. Remove one before bringing another.`, 409);
  }
  const duplicate = await db.projectAgent.findFirst({ where: { projectId: input.project.id, agentCardUrl: cardUrl, status: { not: "removed" } }, select: { id: true } });
  if (duplicate) throw new ProjectAgentError("That agent is already on this project.", 409);

  const card = await fetchAgentCard(cardUrl, transport);
  const row = await db.projectAgent.create({
    data: {
      projectId: input.project.id,
      agentId: `${OUTSIDE_ID_PREFIX}${randomBytes(8).toString("hex")}`,
      ownerUserId: input.ownerUserId,
      origin: OUTSIDE_ORIGIN,
      agentCardUrl: cardUrl,
      status: "connected",
      name: card.name,
      description: card.description,
      endpointUrl: card.endpointUrl,
      protocolDialect: card.dialect,
      lastCheckedAt: new Date(),
      // An outside agent is given nothing of this organization's by default.
      canReadProjectMemory: false,
      canWriteProjectMemory: false,
      canUseComputer: false,
    },
    include: { owner: { select: { id: true, name: true } } },
  });
  await writeAuditLog({
    userId: input.ownerUserId, projectId: input.project.id, action: "project_agent.brought", entityType: "projectAgent", entityId: row.id,
    details: { agentId: row.agentId, origin: OUTSIDE_ORIGIN, host: hostOf(row.endpointUrl), dialect: card.dialect },
  });
  return { agent: toView(row, input.ownerUserId, await userCanShareProject(input.ownerUserId, input.project)), token: projectAgentToken(row.id, row.tokenVersion) };
}

async function loadForChange(project: ProjectRef, agentId: string, actorId: string) {
  const row = await db.projectAgent.findUnique({ where: { projectId_agentId: { projectId: project.id, agentId } } });
  if (!row || row.status === "removed" || row.origin !== OUTSIDE_ORIGIN) throw new ProjectAgentError("That agent is not on this project.", 404);
  const isOwner = row.ownerUserId === actorId;
  const manages = isOwner || (await userCanShareProject(actorId, project));
  if (!manages) throw new ProjectAgentError("Only the person who brought this agent, the project owner or a team admin can change it.", 403);
  return { row, isOwner };
}

const ownerOnly = (isOwner: boolean, what: string) => {
  if (!isOwner) throw new ProjectAgentError(`Only the person who brought this agent can ${what}.`, 403);
};

export async function updateProjectAgent(
  input: { project: ProjectRef; agentId: string; actorId: string; status?: "connected" | "disabled"; canMessageOtherOwners?: boolean },
): Promise<void> {
  const { row, isOwner } = await loadForChange(input.project, input.agentId, input.actorId);
  if (input.status === "connected" && row.status !== "connected") ownerOnly(isOwner, "turn it back on");
  if (input.canMessageOtherOwners !== undefined) ownerOnly(isOwner, "change what it may do");
  const data = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.canMessageOtherOwners !== undefined ? { canMessageOtherOwners: input.canMessageOtherOwners } : {}),
  };
  if (Object.keys(data).length === 0) throw new ProjectAgentError("Nothing to change.", 400);
  await db.projectAgent.update({ where: { id: row.id }, data });
  await writeAuditLog({ userId: input.actorId, projectId: input.project.id, action: "project_agent.updated", entityType: "projectAgent", entityId: row.id, details: { agentId: row.agentId, ...data } });
}

/** Kept, not deleted: the row still names the agent on messages it wrote. Its token stops working. */
export async function removeProjectAgent(input: { project: ProjectRef; agentId: string; actorId: string }): Promise<void> {
  const { row } = await loadForChange(input.project, input.agentId, input.actorId);
  await db.projectAgent.update({ where: { id: row.id }, data: { status: "removed", tokenVersion: { increment: 1 } } });
  await writeAuditLog({ userId: input.actorId, projectId: input.project.id, action: "project_agent.removed", entityType: "projectAgent", entityId: row.id, details: { agentId: row.agentId } });
}

/** A new token; the old one stops being sent at once. */
export async function rotateProjectAgentToken(input: { project: ProjectRef; agentId: string; actorId: string }): Promise<string> {
  const { row, isOwner } = await loadForChange(input.project, input.agentId, input.actorId);
  ownerOnly(isOwner, "issue a new token");
  const updated = await db.projectAgent.update({ where: { id: row.id }, data: { tokenVersion: { increment: 1 } } });
  await writeAuditLog({ userId: input.actorId, projectId: input.project.id, action: "project_agent.token_rotated", entityType: "projectAgent", entityId: row.id, details: { agentId: row.agentId } });
  return projectAgentToken(updated.id, updated.tokenVersion);
}

/** Reads the card again, so a moved or renamed agent is picked up, and records whether it answered. */
export async function recheckProjectAgent(
  input: { project: ProjectRef; agentId: string; actorId: string },
  transport: OutsideTransport = requestOutsideJson,
): Promise<{ ok: boolean; error: string | null }> {
  const { row, isOwner } = await loadForChange(input.project, input.agentId, input.actorId);
  ownerOnly(isOwner, "re-check it");
  if (!row.agentCardUrl) throw new ProjectAgentError("This agent has no Agent Card address.", 409);
  try {
    const card = await fetchAgentCard(row.agentCardUrl, transport);
    await db.projectAgent.update({
      where: { id: row.id },
      data: { name: card.name, description: card.description, endpointUrl: card.endpointUrl, protocolDialect: card.dialect, lastCheckedAt: new Date(), lastError: null },
    });
    return { ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The agent could not be reached.";
    await db.projectAgent.update({ where: { id: row.id }, data: { lastCheckedAt: new Date(), lastError: message.slice(0, 300) } });
    return { ok: false, error: message };
  }
}

/** The connected outside agent with this id on this project, if there is one. */
export async function findConnectedOutsideAgent(projectId: string, agentId: string): Promise<ProjectAgent | null> {
  if (!isOutsideAgentId(agentId)) return null;
  const row = await db.projectAgent.findUnique({ where: { projectId_agentId: { projectId, agentId } } });
  return row && row.origin === OUTSIDE_ORIGIN && row.status === "connected" && row.endpointUrl ? row : null;
}

/**
 * Display names for the outside agents among `agentIds`, including removed
 * ones, so a transcript still says who wrote what after an agent has left.
 */
export async function outsideAgentNames(projectId: string | null, agentIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(agentIds.filter((id): id is string => Boolean(id) && isOutsideAgentId(id!)))];
  if (!projectId || ids.length === 0) return new Map();
  const rows = await db.projectAgent.findMany({
    where: { projectId, agentId: { in: ids } },
    select: { agentId: true, name: true, owner: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.agentId, `${row.name ?? "Agent"} (${row.owner.name ?? "a member"}'s agent)`]));
}
