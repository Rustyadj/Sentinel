import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";
import { listActivityForUser } from "@/lib/activity/feed";
import { ActivityConsole } from "@/modules/activity/components/ActivityConsole";

export const metadata = {
  title: "Activity · Sentinel OS",
};

export default async function ActivityPage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  const items = await listActivityForUser(
    user.id,
    workspaces.map((workspace) => workspace.id),
  );

  return <ActivityConsole items={items} />;
}
