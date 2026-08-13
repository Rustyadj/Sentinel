import { CybersecurityPage } from "@/modules/cybersecurity";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { getLensOverviewStats } from "@/lib/workspaces/lensStats";

export default async function CybersecurityWorkspacePage() {
  const workspace = await getWorkspaceBySlug("cybersecurity");
  if (workspace) await requireWorkspacePermission(workspace.id, "workspace.read");
  const stats = await getLensOverviewStats("cybersecurity");

  return (
    <WorkspaceShell noPadding className="h-full min-h-0 overflow-hidden">
      <CybersecurityPage stats={stats} />
    </WorkspaceShell>
  );
}
