import { AppShell } from "@/components/shell/AppShell";
import { AgentWorkspaceView } from "@/modules/agent-workspaces/components/AgentWorkspaceView";

export default async function AgentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell title="Workspace">
      <div className="h-full overflow-y-auto">
        <AgentWorkspaceView workspaceId={id} />
      </div>
    </AppShell>
  );
}
