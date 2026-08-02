import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS, getVpsAgent } from "@/lib/agents/registry";
import { readFile } from "fs/promises";
import { getContainerLogs } from "@/lib/agents/processControl";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!ALLOWED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.viewLogs);

    const agent = getVpsAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const url = new URL(req.url);
    const parsedLines = Number.parseInt(url.searchParams.get("lines") ?? "100", 10);
    const lines_n = Number.isFinite(parsedLines) ? Math.min(Math.max(parsedLines, 1), 500) : 100;
    const source = url.searchParams.get("source") ?? "docker";

    // Try docker logs first, fall back to log file
    if (source === "docker" || source === "auto") {
      try {
        const { stdout, stderr } = await getContainerLogs(id, lines_n);
        const logLines = (stdout + stderr).split("\n").filter(Boolean);
        return NextResponse.json({ lines: logLines, source: `docker:${agent.containerName}`, agentId: id });
      } catch {
        // fall through to file
      }
    }

    // File-based fallback
    if (agent.logPath) {
      try {
        const content = await readFile(agent.logPath, "utf-8");
        const logLines = content.split("\n").filter(Boolean).slice(-lines_n);
        return NextResponse.json({ lines: logLines, source: `file:${agent.logPath}`, agentId: id });
      } catch {
        // no log file
      }
    }

    return NextResponse.json({
      lines: [`[sentinel] No logs available for ${id}`],
      source: "none",
      agentId: id,
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
