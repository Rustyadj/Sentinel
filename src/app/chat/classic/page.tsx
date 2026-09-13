import { AppShell } from "@/components/layout/AppShell";
import { CollaborationRoom } from "@/components/collaboration/CollaborationRoom";
import { getVpsAgent } from "@/lib/agents/registry";

/**
 * The previous collaboration-room chat, kept reachable while the new Chat
 * surface is verified in real use. It is scheduled for removal once the
 * remaining capabilities it still owns (graph space, collaboration lanes)
 * have moved to the new Graph and Chat surfaces.
 */
export default async function ClassicChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const requestedAgent = (await searchParams).agent;
  const agentId = typeof requestedAgent === "string" && getVpsAgent(requestedAgent) ? requestedAgent : undefined;
  return (
    <AppShell rightPanel={false}>
      <CollaborationRoom initialAgentId={agentId} />
    </AppShell>
  );
}
