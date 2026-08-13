import { StudioPage } from "@/modules/studio";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { LENS_CONFIG } from "@/lib/lensRegistry";

export default async function StudioBuilderPage() {
  const workspace = await getWorkspaceBySlug("studio");
  if (workspace) await requireWorkspacePermission(workspace.id, "workspace.read");

  return (
    <WorkspaceShell noPadding className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <WorkspaceHeader title={LENS_CONFIG.studio.title} description="AI creation environment — build UI components with AI." accent={LENS_CONFIG.studio.accent} showBack={false} />
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[--canvas-card-border]">
        <StudioPage />
      </div>
    </WorkspaceShell>
  );
}
