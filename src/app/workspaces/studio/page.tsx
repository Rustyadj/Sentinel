import { LensOverview } from "@/components/neural-lens/LensOverview";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { getLensOverviewStats } from "@/lib/workspaces/lensStats";
import { LENS_CONFIG } from "@/lib/lensRegistry";

export default async function StudioPage() {
  const workspace = await getWorkspaceBySlug("studio");
  if (workspace) await requireWorkspacePermission(workspace.id, "workspace.read");
  const stats = await getLensOverviewStats("studio");

  return (
    <WorkspaceShell noPadding className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <WorkspaceHeader title={LENS_CONFIG.studio.title} description={LENS_CONFIG.studio.description} accent={LENS_CONFIG.studio.accent} showBack={false} />
      <div className="min-h-0 flex-1">
        <LensOverview lens="studio" stats={stats} />
      </div>
    </WorkspaceShell>
  );
}
