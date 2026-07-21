import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceCard } from "@/components/workspace/WorkspaceCard";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { requireUser } from "@/lib/current-user";
import { listProjects, listWorkspaces } from "@/lib/workspaces";
import { createProjectAction } from "@/app/workspaces/actions";

const field = "h-9 w-full rounded-md border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]";

export default async function ProjectsPage() {
  const user = await requireUser();
  const [projects, workspaces] = await Promise.all([listProjects({ userId: user.id }), listWorkspaces(user.id)]);
  return (
    <AppShell>
      <WorkspaceShell>
        <WorkspaceHeader title="Projects" description="Project records across your workspaces." />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="space-y-3">
            {projects.length === 0 ? (
              <WorkspaceCard>
                <div className="py-10 text-center text-sm text-[--muted-foreground]">No projects yet. Create the first project.</div>
              </WorkspaceCard>
            ) : projects.map((project) => (
              <Link key={project.id} href={project.workspace ? `/workspaces/${project.workspace.slug}/projects` : `/projects?project=${project.id}`}>
                <WorkspaceCard className="mb-3 transition-colors hover:border-[--primary]/40">
                  <div className="flex items-start gap-3">
                    <FolderKanban className="mt-0.5 h-4 w-4 text-[--primary]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold">{project.name}</h2>
                        <span className="rounded-full bg-[--muted] px-2 py-0.5 text-[10px] uppercase text-[--muted-foreground]">{project.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-[--muted-foreground]">{project.description ?? "No description"}</p>
                      <p className="mt-3 text-[11px] text-[--muted-foreground]">{project.workspace?.name ?? "Personal"} · {project._count.tasks} tasks · {project._count.documents} files</p>
                    </div>
                  </div>
                </WorkspaceCard>
              </Link>
            ))}
          </div>
          <WorkspaceCard title="New project" description="Create a persistent project record">
            <form action={createProjectAction} className="space-y-3">
              <label className="block text-xs text-[--muted-foreground]">Name<input name="name" required className={`${field} mt-1`} /></label>
              <label className="block text-xs text-[--muted-foreground]">Description<input name="description" className={`${field} mt-1`} /></label>
              <label className="block text-xs text-[--muted-foreground]">Workspace<select name="workspaceId" className={`${field} mt-1`}><option value="">Personal</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
              <label className="block text-xs text-[--muted-foreground]">Tags<input name="tags" placeholder="design, launch" className={`${field} mt-1`} /></label>
              <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-foreground]"><Plus className="h-4 w-4" />Create project</button>
            </form>
          </WorkspaceCard>
        </div>
      </WorkspaceShell>
    </AppShell>
  );
}
