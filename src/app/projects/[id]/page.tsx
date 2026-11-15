import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { ProjectHub } from "@/components/people/ProjectHub";
import { db } from "@/lib/db";
import { projectRoleAllows } from "@/lib/people/roles";
import { requireProjectPermission, userHasWorkspacePermission } from "@/lib/workspaces/authorization";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Missing and not-yours are the same page: a project you cannot read does not exist for you.
  const access = await requireProjectPermission(id, "project.read").catch(() => null);
  if (!access) notFound();
  const { user } = access;

  const project = await db.project.findUniqueOrThrow({
    where: { id },
    select: { id: true, name: true, description: true, status: true, userId: true, workspaceId: true, workspace: { select: { name: true } }, _count: { select: { tasks: true, documents: true } } },
  });
  const membership = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId: user.id } }, select: { role: true } });
  const canWrite =
    project.userId === user.id ||
    Boolean(membership && projectRoleAllows(membership.role, "project.update")) ||
    Boolean(project.workspaceId && (await userHasWorkspacePermission(user.id, project.workspaceId, "project.update")));

  return (
    <AppShell title="Projects">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8 sm:py-8">
          <Link href="/projects" className="text-[13px] text-(--muted-foreground) underline-offset-2 hover:text-(--foreground) hover:underline">All projects</Link>
          <header className="mb-8 mt-2">
            <h2 className="font-display text-[32px] font-semibold leading-tight tracking-tight">{project.name}</h2>
            {project.description ? <p className="mt-2 max-w-[65ch] text-[14.5px] leading-relaxed text-(--muted-foreground)">{project.description}</p> : null}
            <p className="mt-3 text-[13px] text-(--muted-foreground)">
              {project.workspace?.name ?? "Personal project"}, {project._count.tasks} {project._count.tasks === 1 ? "task" : "tasks"}, {project._count.documents} {project._count.documents === 1 ? "file" : "files"}
              {project.userId !== user.id && membership ? `. You are ${membership.role === "editor" ? "an editor" : "a viewer"} here.` : ""}
            </p>
          </header>
          <ProjectHub project={{ id: project.id, name: project.name }} canWrite={canWrite} />
        </div>
      </div>
    </AppShell>
  );
}
