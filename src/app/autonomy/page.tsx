import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces/objects";
import { AutonomyConsole } from "@/modules/autonomy/components/AutonomyConsole";

export const metadata = { title: "Autonomy · Sentinel OS" };

export default async function AutonomyPage({ searchParams }: {
  searchParams: Promise<{ workspaceId?: string | string[]; tab?: string | string[] }>;
}) {
  const user = await requireUser();
  const [workspaces, params] = await Promise.all([listWorkspaces(user.id), searchParams]);
  const initialWorkspaceId = workspaces.find((workspace) => workspace.id === params.workspaceId)?.id;
  return <AutonomyConsole
    workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))}
    initialWorkspaceId={initialWorkspaceId}
    initialTab={params.tab === "capabilities" ? "capabilities" : "overview"}
  />;
}
