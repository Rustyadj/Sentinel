import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces/objects";
import { AutonomyConsole } from "@/modules/autonomy/components/AutonomyConsole";

export const metadata = { title: "Autonomy · Sentinel OS" };

export default async function AutonomyPage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  return <AutonomyConsole workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))} />;
}
