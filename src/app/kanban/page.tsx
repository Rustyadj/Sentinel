import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";

// kanban/layout.tsx already wraps this route in AppShell — wrapping again
// here rendered the entire TopBar/Sidebar shell twice (and double-fired
// every API call the shell makes on mount).
export default async function KanbanPage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);

  return (
    <WorkspaceShell>
      <WorkspaceHeader title="Kanban" description="Task lanes across your workspaces — drag a card between lanes to change its status." />
      <KanbanBoard workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, color: w.color }))} />
    </WorkspaceShell>
  );
}
