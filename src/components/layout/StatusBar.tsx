"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Clock, Database, Server, Wifi } from "lucide-react";
import { useAgentStore } from "@/store/useAgentStore";

interface ReadyCheck {
  ok: boolean;
  latencyMs?: number;
}

interface ReadyPayload {
  ready: boolean;
  checks: {
    database?: ReadyCheck;
    redis?: ReadyCheck;
    agents?: Record<string, ReadyCheck>;
  };
  timestamp: string;
}

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
  const [ready, setReady] = useState<ReadyPayload | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch("/api/ready", { cache: "no-store" });
        const payload = (await response.json()) as ReadyPayload;
        if (mounted) setReady(payload);
      } catch {
        if (mounted) setReady(null);
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const db = ready?.checks.database;
  const redis = ready?.checks.redis;
  const agentChecks = Object.values(ready?.checks.agents ?? {});
  const onlineAgents = agentChecks.filter((check) => check.ok).length;
  const allSystemsOk = Boolean(ready?.ready && db?.ok && redis?.ok && agentChecks.every((check) => check.ok));
  const updatedAt = ready?.timestamp
    ? new Date(ready.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "pending";

  return (
    <footer className="h-8 shrink-0 border-t border-[--border] bg-[--sidebar] flex items-center gap-4 px-4 text-[11px]">
      <Metric icon={Bot} label="Active Agents" value={`${active}/${total}`} dot="#10b981" />
      <span className="w-px h-3 bg-[--border] hidden md:block" />
      <Metric
        icon={Database}
        label="Database"
        value={db?.ok ? `${db.latencyMs ?? 0}ms` : "offline"}
        dot={db?.ok ? "#10b981" : "#ef4444"}
      />
      <span className="w-px h-3 bg-[--border] hidden md:block" />
      <Metric
        icon={Server}
        label="Redis"
        value={redis?.ok ? `${redis.latencyMs ?? 0}ms` : "offline"}
        dot={redis?.ok ? "#10b981" : "#ef4444"}
      />
      <span className="w-px h-3 bg-[--border] hidden lg:block" />
      <div className="hidden lg:flex items-center gap-4">
        <Metric
          icon={Wifi}
          label="VPS Agents"
          value={`${onlineAgents}/${agentChecks.length || 0}`}
          dot={agentChecks.length > 0 && onlineAgents === agentChecks.length ? "#10b981" : "#f59e0b"}
        />
        <span className="w-px h-3 bg-[--border]" />
        <Metric icon={Clock} label="Checked" value={updatedAt} />
      </div>

      <div className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
        {allSystemsOk ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        )}
        <span className={allSystemsOk ? "text-emerald-400 font-medium" : "text-amber-400 font-medium"}>
          {allSystemsOk ? "All Systems Operational" : "Attention Required"}
        </span>
      </div>
    </footer>
  );
}
