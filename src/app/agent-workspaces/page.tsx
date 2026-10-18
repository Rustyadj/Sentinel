import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { AppShell } from "@/components/shell/AppShell";
import { WorkspaceListView } from "@/modules/agent-workspaces/components/WorkspaceListView";

export default async function AgentWorkspacesPage() {
  const user = await requireUser();
  const workspaceIds = await getAccessibleWorkspaceIds(user.id);
  const tenantWorkspaces = await db.workspace.findMany({
    where: { id: { in: workspaceIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return (
    <AppShell title="Workspaces">
      <div className="h-full overflow-y-auto">
        <WorkspaceListView tenantWorkspaces={tenantWorkspaces} />
      </div>
    </AppShell>
  );
}
