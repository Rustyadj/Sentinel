import { requireAgentRecordUser, forbidden } from "@/lib/agents/permissions";
import { getAgentModelSettings, saveAgentModel } from "@/lib/agents/model-settings";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const user = await requireAgentRecordUser(id);
  if (!user) return forbidden("view agent model configuration");
  return Response.json(await getAgentModelSettings(id, user.id));
}
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  const user = await requireAgentRecordUser(id, true);
  if (!user) return forbidden("configure agent models");
  try {
    const input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Invalid body" }, { status: 400 });
    if (input.reset !== undefined && typeof input.reset !== "boolean") return Response.json({ error: "reset must be a boolean" }, { status: 400 });
    await saveAgentModel(id, user, input);
    return Response.json(await getAgentModelSettings(id, user.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Model configuration failed" }, { status: 400 });
  }
}
