"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CollaborationRoom } from "@/components/collaboration/CollaborationRoom";

const NeuralLens = dynamic(() => import("@/components/neural-lens/NeuralLens").then((module) => module.NeuralLens), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[11px] text-[#71839a]">Loading knowledge graph…</div>,
});

// The "Knowledge Graph" module tab (ModuleTabs.tsx) dispatches
// sentinel:module-tab with tabId "graph" for this page's moduleId "chat".
// This listener is what makes that tab actually switch the canvas — without
// it the tab highlights but the content never changes.
//
// Merged 2026-09-07: main routed ?agent=<id> to CollaborationRoom from an async
// server component, while production had already made this a client component
// for the graph/mission tab switch. Both behaviors are kept here. The agent id
// is read client-side alongside ?space rather than via getVpsAgent(), because
// that helper transitively imports model-policy, which reads process.env and
// does not belong in a client bundle. CollaborationRoom already tolerates an
// unknown initialAgentId.
export default function ChatPage() {
  const [tab, setTab] = useState("mission");
  const [initialAgentId, setInitialAgentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("space") === "graph") {
      setTab("graph");
    }
    const agent = params.get("agent");
    if (agent) setInitialAgentId(agent);
  }, []);

  useEffect(() => {
    const onModuleTab = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string; tabId: string }>).detail;
      if (detail?.moduleId !== "chat") return;
      if (detail.tabId === "graph" || detail.tabId === "mission") {
        setTab(detail.tabId);
      }
    };
    window.addEventListener("sentinel:module-tab", onModuleTab);
    return () => window.removeEventListener("sentinel:module-tab", onModuleTab);
  }, []);

  if (tab === "graph") {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#050810]">
        <NeuralLens />
      </div>
    );
  }

  return <CollaborationRoom initialAgentId={initialAgentId} />;
}
