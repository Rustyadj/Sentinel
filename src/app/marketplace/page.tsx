import { AppShell } from "@/components/layout/AppShell";
import { MarketplaceClient } from "@/components/marketplace/MarketplaceClient";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { db } from "@/lib/db";
import { MODULE_MANIFESTS } from "@/lib/modules/manifests";
import { requireUser } from "@/lib/current-user";

export default async function MarketplacePage() {
  await requireUser();
  const installed = await db.installedModule.findMany({ where: { enabled: true }, select: { moduleId: true } });
  return (
    <AppShell>
      <WorkspaceShell>
        <WorkspaceHeader title="Module Marketplace" description="Install local Sentinel modules with explicit manifest v2 permissions." />
        <MarketplaceClient manifests={MODULE_MANIFESTS} installedModuleIds={installed.map((item) => item.moduleId)} />
      </WorkspaceShell>
    </AppShell>
  );
}
