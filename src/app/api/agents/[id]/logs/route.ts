import { NextResponse } from "next/server";
import { isAllowedVpsAgentId, getVpsAgent } from "@/lib/agents/registry";
import { getControlPlaneUser, canViewAgent, unauthorized } from "@/lib/agents/permissions";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";

const execAsync = promisify(exec);

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const user = await getControlPlaneUser();
  if (!user || !canViewAgent(user.role)) return unauthorized();

  const { id } = await params;
  if (!(await isAllowedVpsAgentId(id))) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = await getVpsAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const url = new URL(req.url);
  const lines_n = Math.min(parseInt(url.searchParams.get("lines") ?? "100"), 500);
  const source = url.searchParams.get("source") ?? "docker";

  // Try docker logs first, fall back to log file
  if (source === "docker" || source === "auto") {
    try {
      const { stdout, stderr } = await execAsync(
        `docker logs --tail ${lines_n} ${id} 2>&1`,
        { timeout: 8000 }
      );
      const logLines = (stdout + stderr).split("\n").filter(Boolean);
      return NextResponse.json({ lines: logLines, source: `docker:${id}`, agentId: id });
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
}
