import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces/objects";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { WorkforceConsole } from "@/modules/workforce/components/WorkforceConsole";

export const metadata = { title: "Workforce · Sentinel OS" };

export default async function WorkforcePage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  const choices = await Promise.all(workspaces.filter((workspace) => workspace.enabled).map(async (workspace) =>
    await userHasWorkspacePermission(user.id, workspace.id, "workspace.read")
      ? { id: workspace.id, name: workspace.name, organization: workspace.organizationId !== null }
      : null,
  ));
  const available = choices.filter((choice) => choice !== null);
  available.sort((a, b) => Number(b.organization) - Number(a.organization));
  return <WorkforceConsole workspaces={available.map(({ id, name }) => ({ id, name }))} />;
}
