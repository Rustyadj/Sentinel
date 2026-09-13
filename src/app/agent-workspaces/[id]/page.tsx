import { AppShell } from "@/components/shell/AppShell";
import { AgentWorkspaceView } from "@/modules/agent-workspaces/components/AgentWorkspaceView";

export default async function AgentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell header={<span className="text-[15px] font-medium">Workspace</span>}>
      <div className="h-full overflow-y-auto">
        <AgentWorkspaceView workspaceId={id} />
      </div>
    </AppShell>
  );
}
