import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Workspace state and agent memory stay separate systems. Memory records a
 * short *reference* to something durable that happened in a workspace — never
 * file contents, listings or command output.
 */
export async function recordWorkspaceMemoryReference(input: {
  workspace: AgentWorkspace;
  content: string;
  tags?: string[];
  importanceScore?: number;
}) {
  if (input.content.length > 500) {
    throw new Error("Workspace memory references must stay short — link, do not copy.");
  }
  try {
    return await db.memory.create({
      data: {
        type: "workspace_reference",
        scope: "agent",
        owner: input.workspace.agentId,
        content: input.content,
        tags: ["agent-workspace", input.workspace.id, ...(input.tags ?? [])],
        source: `agent-workspace:${input.workspace.id}`,
        importanceScore: input.importanceScore ?? 0.5,
        projectId: input.workspace.projectId,
      },
    });
  } catch (error) {
    // A memory reference is a convenience, never a precondition for the
    // workspace operation that produced it.
    logger.warn("agent-workspace memory reference failed", { workspaceId: input.workspace.id, error: String(error) });
    return null;
  }
}
