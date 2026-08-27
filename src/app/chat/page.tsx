import { CollaborationRoom } from "@/components/collaboration/CollaborationRoom";
import { getVpsAgent } from "@/lib/agents/registry";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const requestedAgent = (await searchParams).agent;
  const agentId = typeof requestedAgent === "string" && getVpsAgent(requestedAgent)
    ? requestedAgent
    : undefined;

  return <CollaborationRoom initialAgentId={agentId} />;
}
