"use client";

import { useEffect, useState } from "react";
import { MissionPanel, PanelLink, UnavailableState } from "./MissionPanel";
import type { DataSourceState } from "@/lib/mission-control/types";

interface Counts { memory: number; skills: number; degraded: number; clients: number }
export function AdaptiveGovernanceOverview() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [source, setSource] = useState<DataSourceState>({ state: "unavailable", source: "Adaptive governance", observedAt: null, reason: "Loading review queues." });
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/adaptive-memory/candidates", { cache: "no-store", signal: controller.signal }),
      fetch("/api/adaptive-memory/skills/candidates", { cache: "no-store", signal: controller.signal }),
      fetch("/api/mcp/clients", { cache: "no-store", signal: controller.signal }),
    ]).then(async (responses) => {
      if (responses.some((response) => !response.ok)) throw new Error("One or more governance sources are unavailable.");
      const [memory, skills, clients] = await Promise.all(responses.map((response) => response.json()));
      setCounts({
        memory: memory.filter((item: { status: string }) => ["pending", "quarantined"].includes(item.status)).length,
        skills: skills.filter((item: { status: string }) => ["testing", "pending_review"].includes(item.status)).length,
        degraded: skills.filter((item: { status: string }) => item.status === "degraded").length,
        clients: clients.filter((item: { revokedAt: string | null; expiresAt: string }) => !item.revokedAt && new Date(item.expiresAt) > new Date()).length,
      });
      setSource({ state: "live", source: "Adaptive governance", observedAt: new Date().toISOString() });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSource({ state: "unavailable", source: "Adaptive governance", observedAt: null, reason: error instanceof Error ? error.message : "Governance data unavailable." });
    });
    return () => controller.abort();
  }, []);
  return <MissionPanel title="Adaptive Governance" sourceState={source} action={<PanelLink href="/memory">Review knowledge</PanelLink>} contentClassName="p-4">
    {!counts ? <UnavailableState source={source} emptyMessage="No adaptive review records." /> : <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
      {[{ label: "Memory reviews", value: counts.memory }, { label: "Skill reviews", value: counts.skills }, { label: "Degraded skills", value: counts.degraded }, { label: "MCP clients", value: counts.clients }].map((item) =>
        <div key={item.label} className="rounded-lg border border-white/[0.07] bg-black/10 p-3"><div className="text-lg font-semibold text-white">{item.value}</div><div className="mt-1 text-[9px] text-[#8995a6]">{item.label}</div></div>)}
    </div>}
    <p className="mt-3 text-[9px] text-[#69778a]">Workflow and agent health require an explicit workspace scope and are shown in Knowledge Governance.</p>
  </MissionPanel>;
}
