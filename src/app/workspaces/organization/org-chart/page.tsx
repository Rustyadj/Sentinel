import { OrgPage } from "@/modules/organization";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { LENS_CONFIG } from "@/lib/lensRegistry";

export default async function OrganizationChartPage() {
  const workspace = await getWorkspaceBySlug("organization");
  if (workspace) await requireWorkspacePermission(workspace.id, "workspace.read");

  return (
    <WorkspaceShell noPadding className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <WorkspaceHeader title={LENS_CONFIG.organization.title} description="Interactive organization chart for people, agents, teams, and departments." accent={LENS_CONFIG.organization.accent} showBack={false} />
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[--canvas-card-border]">
        <OrgPage />
      </div>
    </WorkspaceShell>
  );
}
