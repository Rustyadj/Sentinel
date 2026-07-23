import type {
  AgentOperation,
  AttentionItem,
  ContinueItem,
  ContinueItemType,
  FeedScope,
  MissionFeedItem,
} from "./types";

const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function selectAttentionByPriority(items: AttentionItem[]): AttentionItem[] {
  return items.toSorted((left, right) => severityRank[left.severity] - severityRank[right.severity]);
}

export function selectContinueItems(items: ContinueItem[], type: ContinueItemType): ContinueItem[] {
  return items.filter((item) => item.type === type);
}

export function selectActiveAgents(agents: AgentOperation[]): AgentOperation[] {
  return agents.filter((agent) => agent.status === "online" || agent.status === "busy");
}

export function selectMissionFeed(items: MissionFeedItem[], scope: FeedScope): MissionFeedItem[] {
  return scope === "all" ? items : items.filter((item) => item.scope === scope);
}

export function selectAttentionCount(items: AttentionItem[], categories: AttentionItem["category"][]): number {
  const categorySet = new Set(categories);
  return items.filter((item) => categorySet.has(item.category)).length;
}
