import { Activity, Box, Cpu, Database, Gauge, HardDrive, MemoryStick, Network, RadioTower } from "lucide-react";
import type { DataSourceState, HealthItem } from "@/lib/mission-control/types";
import { MissionPanel, PanelLink, StatusDot } from "./MissionPanel";

const icons = { cpu: Cpu, memory: MemoryStick, disk: HardDrive, containers: Box, postgres: Database, redis: Database, network: Network, "active-agents": RadioTower, usage: Gauge };

export function SystemHealth({ items, sourceState }: { items: HealthItem[]; sourceState: DataSourceState }) {
  return (
    <MissionPanel title="System Health" sourceState={sourceState} action={<PanelLink href="/settings">Open monitor</PanelLink>} contentClassName="p-0">
      <ul className="divide-y divide-white/[0.07]" role="list">
        {items.map((item) => {
          const Icon = icons[item.id as keyof typeof icons] ?? Activity;
          const tone = item.status === "healthy" ? "positive" : item.status === "degraded" || item.status === "active" ? "warning" : item.status === "unavailable" ? "neutral" : "critical";
          return (
            <li key={item.id} className="grid grid-cols-[minmax(120px,1fr)_90px_minmax(90px,0.9fr)] items-center gap-2 px-4 py-2.5 hover:bg-white/[0.022]">
              <span className="flex items-center gap-2 text-[10px] text-[#e1e6ed]"><Icon className="h-3.5 w-3.5 text-[#98a6b8]" />{item.label}</span>
              <span className="flex items-center gap-1.5 text-[8px] capitalize text-[#9da8b7]"><StatusDot tone={tone} />{item.status}</span>
              <span className="min-w-0 text-right"><span className="block truncate text-[9px] tabular-nums text-[#c8d0dc]">{item.value}</span><span className="block truncate text-[8px] text-[#6f7c8e]">{item.detail}</span></span>
            </li>
          );
        })}
      </ul>
    </MissionPanel>
  );
}
