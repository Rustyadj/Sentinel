import { MarketingPage } from "@/modules/marketing";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { getLensOverviewStats } from "@/lib/workspaces/lensStats";

export default async function MarketingWorkspacePage() {
  const workspace = await getWorkspaceBySlug("marketing");
  if (workspace) await requireWorkspacePermission(workspace.id, "workspace.read");
  const stats = await getLensOverviewStats("marketing");

  return (
    <WorkspaceShell noPadding className="h-full min-h-0 overflow-hidden">
      <MarketingPage stats={stats} />
    </WorkspaceShell>
  );
}
