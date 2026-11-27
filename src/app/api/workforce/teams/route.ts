import { z } from "zod";
import { db } from "@/lib/db";
import { RETIRED_AGENT_IDS } from "@/lib/agents/active";
import { createTeam, updateTeam } from "@/lib/workspaces/teams";
import { requireWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";

const id = z.string().trim().min(1).max(100);
const schema = z.strictObject({
  id: id.optional(),
  workspaceId: id,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
  memberAgentIds: z.array(id).max(100),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid team details." }, { status: 400 });
  const { workspaceId, id, name, description } = parsed.data;
  const memberAgentIds = [...new Set(parsed.data.memberAgentIds)];
  try {
    const user = await requireWorkspacePermission(workspaceId, id ? "team.update" : "team.create");
    const [team, eligibleCount] = await Promise.all([
      id ? db.team.findFirst({ where: { id, workspaceId }, select: { id: true } }) : null,
      db.agent.count({ where: { workspaceId, id: { in: memberAgentIds, notIn: [...RETIRED_AGENT_IDS] } } }),
    ]);
    if (id && !team) return Response.json({ error: "Team not found." }, { status: 404 });
    if (eligibleCount !== memberAgentIds.length) return Response.json({ error: "Select available agent records from this workspace." }, { status: 400 });
    const data = { name, description, memberAgentIds };
    const result = id ? await updateTeam(id, data, user.id) : await createTeam({ ...data, workspaceId }, user.id);
    return Response.json({
      team: { id: result.id, name: result.name, description: result.description, memberAgentIds: result.memberAgentIds },
    }, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return Response.json({ error: "A team with this name already exists in the workspace." }, { status: 409 });
    }
    throw error;
  }
}
