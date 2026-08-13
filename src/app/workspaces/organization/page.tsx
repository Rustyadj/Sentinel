import { LensOverview } from "@/components/neural-lens/LensOverview";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { getLensOverviewStats } from "@/lib/workspaces/lensStats";
import { LENS_CONFIG } from "@/lib/lensRegistry";

export default async function OrganizationPage() {
  const workspace = await getWorkspaceBySlug("organization");
  if (workspace) await requireWorkspacePermission(workspace.id, "workspace.read");
  const stats = await getLensOverviewStats("organization");

  return (
    <WorkspaceShell noPadding className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <WorkspaceHeader title={LENS_CONFIG.organization.title} description={LENS_CONFIG.organization.description} accent={LENS_CONFIG.organization.accent} showBack={false} />
      <div className="min-h-0 flex-1">
        <LensOverview lens="organization" stats={stats} />
      </div>
    </WorkspaceShell>
  );
}
