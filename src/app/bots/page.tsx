import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { BotsPage } from "@/modules/bots/components/BotsPage";

export const metadata = { title: "Bots · Sentinel OS" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const ids = await getAccessibleWorkspaceIds(user.id);
  const workspaces = await db.workspace.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <BotsPage workspaces={workspaces} />;
}
