import Link from "next/link";
import { CalendarClock, FileText, FolderKanban, ListChecks, Users } from "lucide-react";
import { db } from "@/lib/db";
import { getWorkspaceBySlug, listProjects, listTeams, WORKSPACE_NAV } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { WorkspaceCard, StatCard } from "./WorkspaceCard";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceShell } from "./WorkspaceShell";

export async function DatabaseWorkspaceOverview({ slug }: { slug: string }) {
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) return null;
  await requireWorkspacePermission(workspace.id, "workspace.read");
  const [projects, teams, tasks, documents, meetings] = await Promise.all([
    listProjects({ workspaceId: workspace.id }),
    listTeams(workspace.id),
    db.task.count({ where: { workspaceId: workspace.id } }),
    db.document.count({ where: { workspaceId: workspace.id } }),
    db.meeting.count({ where: { workspaceId: workspace.id, startsAt: { gte: new Date() } } }),
  ]);
  const navigation = WORKSPACE_NAV.find((item) => item.id === slug)?.subnav ?? [];

  return (
    <WorkspaceShell>
      <WorkspaceHeader title={`${workspace.name} Console`} description={workspace.description ?? "Workspace operations"} accent={workspace.color} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Projects" value={projects.length} color={workspace.color} />
        <StatCard label="Teams" value={teams.length} color={workspace.color} />
        <StatCard label="Tasks" value={tasks} color={workspace.color} />
        <StatCard label="Documents" value={documents} color={workspace.color} />
        <StatCard label="Meetings" value={meetings} color={workspace.color} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <WorkspaceCard title="Projects" actions={<FolderKanban className="h-4 w-4 text-[--primary]" />}>
          {projects.length === 0 ? <p className="text-xs text-[--muted-foreground]">No projects yet.</p> : <div className="space-y-3">{projects.slice(0, 6).map((project) => <div key={project.id} className="flex justify-between gap-3 text-xs"><span className="truncate">{project.name}</span><span className="text-[--muted-foreground]">{project.status}</span></div>)}</div>}
        </WorkspaceCard>
        <WorkspaceCard title="Teams" actions={<Users className="h-4 w-4 text-[--primary]" />}>
          {teams.length === 0 ? <p className="text-xs text-[--muted-foreground]">No teams yet.</p> : <div className="space-y-3">{teams.slice(0, 6).map((team) => <div key={team.id} className="flex justify-between gap-3 text-xs"><span className="truncate">{team.name}</span><span className="text-[--muted-foreground]">{team.memberUserIds.length + team.memberAgentIds.length} members</span></div>)}</div>}
        </WorkspaceCard>
        <WorkspaceCard title="Modules" actions={<ListChecks className="h-4 w-4 text-[--primary]" />}>
          <div className="grid grid-cols-2 gap-2">
            {navigation.filter((item) => item.href !== `/workspaces/${slug}`).map((item) => <Link key={item.id} href={item.href} className="rounded-md border border-[--border] px-3 py-2 text-xs text-[--muted-foreground] hover:border-[--primary]/40 hover:text-[--foreground]">{item.label}</Link>)}
          </div>
        </WorkspaceCard>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-2 rounded-lg border border-[--border] bg-[--canvas-card] p-3 text-xs text-[--muted-foreground]"><ListChecks className="h-4 w-4 text-[--primary]" />{tasks} tracked tasks</div>
        <div className="flex items-center gap-2 rounded-lg border border-[--border] bg-[--canvas-card] p-3 text-xs text-[--muted-foreground]"><FileText className="h-4 w-4 text-[--primary]" />{documents} stored documents</div>
        <div className="flex items-center gap-2 rounded-lg border border-[--border] bg-[--canvas-card] p-3 text-xs text-[--muted-foreground]"><CalendarClock className="h-4 w-4 text-[--primary]" />{meetings} upcoming meetings</div>
      </div>
    </WorkspaceShell>
  );
}
