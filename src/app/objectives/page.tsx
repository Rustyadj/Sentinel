import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces/objects";
import { objectivesEnabled } from "@/lib/objectives/engine";
import { ObjectivesConsole } from "@/modules/objectives/components/ObjectivesConsole";

export const metadata = { title: "Objectives · Sentinel OS" };

export default async function ObjectivesPage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  return <ObjectivesConsole enabled={objectivesEnabled()} workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))} />;
}
