"use client";

import { useEffect, useState } from "react";

/** An agent someone brought to a project, as the chat needs it. Client-safe: no server imports. */
export interface OutsideAgent {
  agentId: string;
  name: string;
  ownerName: string;
  isYours: boolean;
}

interface ListedAgent { agentId: string; name: string; status: string; isYours: boolean; owner: { name: string } }

/** The connected outside agents on a project. Empty when there is no project or none are connected. */
export function useOutsideAgents(projectId: string | undefined): OutsideAgent[] {
  const [loaded, setLoaded] = useState<{ projectId: string; agents: OutsideAgent[] } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/projects/${projectId}/agents`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { agents: ListedAgent[] }).agents : []))
      .catch(() => [] as ListedAgent[])
      .then((agents) => {
        if (!live) return;
        setLoaded({
          projectId,
          agents: agents.filter((a) => a.status === "connected").map((a) => ({ agentId: a.agentId, name: a.name, ownerName: a.owner.name, isYours: a.isYours })),
        });
      });
    return () => { live = false; };
  }, [projectId]);
  // Agents of a project the page has since left are never offered.
  return loaded && loaded.projectId === projectId ? loaded.agents : [];
}
