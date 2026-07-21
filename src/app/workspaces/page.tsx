import Link from "next/link";
import { Building2, LayoutGrid, Megaphone, Shield, Wand2, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

const icons: Record<string, LucideIcon> = { Building2, LayoutGrid, Megaphone, Shield, Wand2 };

export default async function WorkspacesPage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);

  return (
    <WorkspaceShell>
      <WorkspaceHeader title="Workspaces" description="Persistent operating environments for teams, agents, and projects." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => {
          const Icon = icons[workspace.icon] ?? LayoutGrid;
          return (
            <Link
              key={workspace.id}
              href={`/workspaces/${workspace.slug}`}
              className="group rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] p-5 transition-colors hover:border-[--primary]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[--muted]">
                  <Icon className="h-5 w-5" style={{ color: workspace.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-[--canvas-card-foreground]">{workspace.name}</h2>
                  <p className="mt-1 min-h-10 text-xs leading-relaxed text-[--muted-foreground]">{workspace.description}</p>
                  <div className="mt-4 flex gap-3 text-[11px] text-[--muted-foreground]">
                    <span>{workspace._count.projects} projects</span>
                    <span>{workspace._count.teams} teams</span>
                    <span>{workspace._count.approvals} approvals</span>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </WorkspaceShell>
  );
}
