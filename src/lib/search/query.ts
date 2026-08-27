import { db } from "@/lib/db";
import { getAllVpsAgents } from "@/lib/agents/registry";
import { memoryReadWhere } from "@/lib/knowledge/memoryAccess";

export type SearchResultKind = "task" | "agent" | "memory" | "workspace";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const PER_KIND_LIMIT = 8;

/**
 * Global search, phase 1: literal substring match across the entities that
 * already have a real page to land on (Tasks, Agents, Memory, Workspaces).
 * Deliberately not semantic yet — Memory already has pgvector embeddings,
 * but wiring ranked semantic retrieval in belongs with a follow-up that also
 * covers conversations/artifacts, not bundled into the first pass at making
 * search exist at all.
 */
export async function searchAll(userId: string, workspaceIds: string[], query: string): Promise<Record<SearchResultKind, SearchResult[]>> {
  const q = query.trim();
  if (!q) return { task: [], agent: [], memory: [], workspace: [] };

  const [tasks, memories, workspaces] = await Promise.all([
    workspaceIds.length
      ? db.task.findMany({
          where: {
            workspaceId: { in: workspaceIds },
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, title: true, status: true },
          take: PER_KIND_LIMIT,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    db.memory.findMany({
      where: {
        AND: [
          await memoryReadWhere(userId),
          { archived: false },
          {
            OR: [
              { content: { contains: q, mode: "insensitive" } },
              { source: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, content: true, scope: true },
      take: PER_KIND_LIMIT,
      orderBy: { importanceScore: "desc" },
    }),
    db.workspace.findMany({
      where: {
        id: { in: workspaceIds },
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, slug: true, name: true, kind: true },
      take: PER_KIND_LIMIT,
    }),
  ]);

  const agents = getAllVpsAgents()
    .filter((agent) => agent.name.toLowerCase().includes(q.toLowerCase()) || agent.description.toLowerCase().includes(q.toLowerCase()))
    .slice(0, PER_KIND_LIMIT);

  return {
    task: tasks.map((task) => ({
      kind: "task",
      id: task.id,
      title: task.title,
      subtitle: task.status,
      href: "/tasks",
    })),
    agent: agents.map((agent) => ({
      kind: "agent",
      id: agent.id,
      title: agent.name,
      subtitle: agent.description,
      href: "/agents",
    })),
    memory: memories.map((memory) => ({
      kind: "memory",
      id: memory.id,
      title: memory.content.length > 120 ? `${memory.content.slice(0, 117)}...` : memory.content,
      subtitle: memory.scope,
      href: "/memory",
    })),
    workspace: workspaces.map((workspace) => ({
      kind: "workspace",
      id: workspace.id,
      title: workspace.name,
      subtitle: workspace.kind,
      href: `/workspaces/${workspace.slug}`,
    })),
  };
}
