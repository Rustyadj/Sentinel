import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS } from "@/lib/agents/registry";
import { listConfigFiles } from "@/lib/agents/configEditor";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!ALLOWED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.view);
    const files = await listConfigFiles(id);
    return NextResponse.json({ files, agentId: id });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
