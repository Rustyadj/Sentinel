import { z } from "zod";
import { canEditConfig, getWorkspaceControlPlaneUser } from "@/lib/agents/permissions";
import { db } from "@/lib/db";
import { getVisibleWorkforceOrganization } from "@/lib/workforce/organization";
import { planWorkforce, WorkforcePlanningError } from "@/lib/workforce/planning";

const requestSchema = z.strictObject({
  workspaceId: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(1).max(6_000),
});

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "A workspace and an instruction of up to 6,000 characters are required." }, { status: 400 });
  const { workspaceId, instruction } = body.data;
  const user = await getWorkspaceControlPlaneUser(workspaceId);
  if (!user || !canEditConfig(user.role)) return Response.json({ error: "Workforce planning requires workspace configuration access." }, { status: 403 });
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true, organization: { select: { id: true, name: true, ownerId: true } } },
  });
  const org = await getVisibleWorkforceOrganization(user.id, workspace.organization);
  try {
    return Response.json({ plan: await planWorkforce(instruction, org?.name ?? workspace.name, request.signal) });
  } catch (error) {
    if (error instanceof WorkforcePlanningError) return Response.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
