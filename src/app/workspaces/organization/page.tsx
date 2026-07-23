import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { OrgPage } from "@/modules/organization/components/OrgPage";

export default function OrganizationPage() {
  return (
    <WorkspaceShell noPadding className="h-full min-h-0 overflow-hidden">
      <OrgPage />
    </WorkspaceShell>
  );
}
