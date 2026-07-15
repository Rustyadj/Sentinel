"use client";

import { useEffect, useState } from "react";
import { Bot, Gauge, MemoryStick, Wifi, Clock, CheckCircle2 } from "lucide-react";
import { useAgentStore } from "@/store/useAgentStore";

function Metric({
  icon: Icon,
  label,
  value,
  dot,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  dot?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <Icon className="w-3 h-3 text-[--muted-foreground]" />
      <span className="text-[--muted-foreground] hidden lg:inline">{label}</span>
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
          style={{ backgroundColor: dot }}
        />
      )}
      <span className="text-[--foreground] font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function StatusBar() {
  const { agents } = useAgentStore();
  const total = agents.length;
  const active = agents.filter((a) => a.status !== "offline").length;

  // Client-only live clock for the uptime read-out (avoids hydration drift).
  const [uptime, setUptime] = useState("7d 14h 32m");
  useEffect(() => {
    const start = Date.now() - (7 * 86400 + 14 * 3600 + 32 * 60) * 1000;
    const tick = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      setUptime(`${d}d ${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="h-8 shrink-0 border-t border-[--border] bg-[--sidebar] flex items-center gap-4 px-4 text-[11px]">
      <Metric icon={Bot} label="Active Agents" value={`${active}/${total}`} dot="#10b981" />
      <span className="w-px h-3 bg-[--border] hidden md:block" />
      <Metric icon={Gauge} label="System Load" value="23%" dot="#3b82f6" />
      <span className="w-px h-3 bg-[--border] hidden md:block" />
      <Metric icon={MemoryStick} label="Memory" value="6.2 GB / 16 GB" dot="#8b5cf6" />
      <span className="w-px h-3 bg-[--border] hidden lg:block" />
      <div className="hidden lg:flex items-center gap-4">
        <Metric icon={Wifi} label="Network" value="45.2 Mbps" dot="#10b981" />
        <span className="w-px h-3 bg-[--border]" />
        <Metric icon={Clock} label="Uptime" value={uptime} />
      </div>

      <div className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-emerald-400 font-medium">All Systems Operational</span>
      </div>
    </footer>
  );
}
