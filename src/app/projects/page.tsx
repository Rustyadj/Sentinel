import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/current-user";
import { listProjects } from "@/lib/workspaces/projects";
import { listWorkspaces } from "@/lib/workspaces/objects";
import { createProjectAction } from "@/app/workspaces/actions";

const field = "mt-1.5 h-10 w-full rounded-(--radius-md) border border-(--border) bg-(--background) px-3 text-[14px] text-(--foreground) hover:border-(--border-strong) focus-visible:border-(--ring) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)/40";

export default async function ProjectsPage() {
  const user = await requireUser();
  const guest = user.accessScope === "guest";
  const [projects, workspaces] = await Promise.all([listProjects({ userId: user.id }), listWorkspaces(user.id)]);
  return (
    <AppShell title="Projects">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1180px] gap-8 px-4 py-6 sm:px-8 sm:py-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <header className="mb-6">
              <h2 className="font-display text-[30px] font-semibold leading-tight tracking-tight">{guest ? "Projects you were invited to" : "Your projects"}</h2>
              <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-(--muted-foreground)">
                A project has its own rooms, tasks and roundtables. Open one to see who is on it{guest ? "." : " or to invite someone."}
              </p>
            </header>
            {projects.length === 0 ? (
              <p className="rounded-(--radius-lg) border border-dashed border-(--border-strong) px-6 py-12 text-center text-[14px] text-(--muted-foreground)">
                {guest ? "No projects yet. When someone adds you to one, it appears here." : "No projects yet. Create the first one."}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {projects.map((project) => {
                  const mine = project.userId === user.id;
                  return (
                    <li key={project.id}>
                      <Link href={`/projects/${project.id}`} className="card-hover flex h-full flex-col rounded-(--radius-lg) border border-(--border) bg-(--panel) p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-display text-[19px] font-semibold leading-snug tracking-tight">{project.name}</span>
                          {mine ? null : <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) px-2.5 py-0.5 text-[12px] text-(--entity-project)"><Users aria-hidden className="h-3 w-3" />Shared with you</span>}
                        </span>
                        <span className="mt-1.5 line-clamp-2 flex-1 text-[13.5px] leading-snug text-(--muted-foreground)">{project.description ?? "No description yet."}</span>
                        <span className="mt-4 text-[12.5px] text-(--text-faint)">
                          {project.workspace?.name ?? "Personal"}, {project._count.tasks} {project._count.tasks === 1 ? "task" : "tasks"}, {project._count.documents} {project._count.documents === 1 ? "file" : "files"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {guest ? null : (
            <aside aria-labelledby="new-project-heading" className="h-fit rounded-(--radius-lg) border border-(--border) bg-(--panel) p-5 xl:sticky xl:top-6">
              <h2 id="new-project-heading" className="mb-4 font-display text-[19px] font-semibold tracking-tight">New project</h2>
              <form action={createProjectAction} className="space-y-4">
                <label className="block text-[13px] font-medium">Name<input name="name" required maxLength={120} className={field} /></label>
                <label className="block text-[13px] font-medium">What it is for<input name="description" maxLength={300} className={field} /></label>
                <label className="block text-[13px] font-medium">Workspace
                  <select name="workspaceId" className={field}><option value="">Personal</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>
                </label>
                <label className="block text-[13px] font-medium">Tags<input name="tags" placeholder="design, launch" className={field} /></label>
                <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-(--primary) px-5 text-[13.5px] font-semibold text-(--primary-foreground) transition-colors hover:bg-(--primary-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--panel)"><Plus className="h-4 w-4" />Create project</button>
              </form>
            </aside>
          )}
        </div>
      </div>
    </AppShell>
  );
}
