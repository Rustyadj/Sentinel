"use client";

import {
  MessageSquare,
  Bot,
  Brain,
  Activity,
  ArrowUpRight,
  Cpu,
  Zap,
  Clock,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { useAgentStore } from "@/store/useAgentStore";
import { useMemoryStore } from "@/store/useMemoryStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { STATUS_COLORS } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";

const RECENT_ACTIVITY = [
  { agent: "Hermes Lisa",  action: "Completed task analysis",      msAgo: 2 * 60 * 1000,      color: "#8B5CF6" },
  { agent: "Claude Code",  action: "Generated Prisma schema",       msAgo: 8 * 60 * 1000,      color: "#3B82F6" },
  { agent: "OpenClaw",     action: "Research: Next.js 16 features", msAgo: 15 * 60 * 1000,     color: "#F59E0B" },
  { agent: "Hermes Lisa",  action: "Memory checkpoint saved",       msAgo: 45 * 60 * 1000,     color: "#8B5CF6" },
];

const NOW = new Date();

export default function HomePage() {
  const { agents } = useAgentStore();
  const { memories } = useMemoryStore();

  const onlineAgents = agents.filter((a) => a.status === "online").length;
  const busyAgents = agents.filter((a) => a.status === "busy").length;
  const totalMemories = memories.length;
  const pinnedMemories = memories.filter((m) => m.pinned).length;

  return (
    <AppShell>
      <div className="max-w-7xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold text-[--foreground]">Mission Control</h1>
          <p className="mt-0.5 text-sm text-[--muted-foreground]">
            System overview ·{" "}
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="Active Agents" value={onlineAgents} sub={`${busyAgents} running tasks`} icon={Bot} accent="#8B5CF6" trend="+2 today" />
          <StatCard label="Messages Today" value={247} sub="across 3 rooms" icon={MessageSquare} accent="#3B82F6" trend="+18%" />
          <StatCard label="Memory Entries" value={totalMemories} sub={`${pinnedMemories} pinned`} icon={Brain} accent="#10B981" trend="quality first" />
          <StatCard label="Tasks Completed" value={12} sub="5 pending" icon={CheckCircle2} accent="#F59E0B" trend="this sprint" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Agent Roster</CardTitle>
                <Link href="/agents" className="flex items-center gap-1 text-xs text-[--primary] hover:underline">
                  Manage <ArrowUpRight className="w-3 h-3" />
                </Link>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {agents.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  System Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <StatusRow label="API Gateway" status="operational" latency="42ms" />
                <StatusRow label="Memory Store" status="operational" latency="8ms" />
                <StatusRow label="WebSocket" status="degraded" latency="—" />
                <StatusRow label="Database" status="operational" latency="12ms" />
                <StatusRow label="Vector Index" status="operational" latency="95ms" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-blue-400" />
                  Resource Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <ResourceBar label="Context Usage" value={34} color="#6366f1" />
                <ResourceBar label="Memory Capacity" value={22} color="#10B981" />
                <ResourceBar label="API Quota" value={61} color="#F59E0B" />
                <ResourceBar label="Tool Calls/hr" value={45} color="#3B82F6" />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Quick Launch
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Start Chat", href: "/chat", icon: MessageSquare, color: "#3B82F6" },
                  { label: "New Agent", href: "/agents", icon: Bot, color: "#8B5CF6" },
                  { label: "Add Memory", href: "/memory", icon: Brain, color: "#10B981" },
                  { label: "Workspaces", href: "/workspaces", icon: Zap, color: "#F59E0B" },
                ].map(({ label, href, icon: Icon, color }) => (
                  <Link
                    key={label}
                    href={href}
                    className="group flex items-center gap-2.5 rounded-lg border border-[--border] p-3 transition-colors hover:border-[--primary]/40 hover:bg-[--accent]"
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: color + "20" }}
                    >
                      <Icon className="w-4 h-4" style={{ color }} />
                    </div>
                    <span className="text-sm text-[--foreground] transition-colors group-hover:text-[--primary]">
                      {label}
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[--muted-foreground]" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {RECENT_ACTIVITY.map((item, i) => {
                  const time = new Date(NOW.getTime() - item.msAgo);
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <div
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
                        style={{ backgroundColor: item.color + "22" }}
                      >
                        <CheckCircle2 className="w-3 h-3" style={{ color: item.color }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[--foreground]">{item.agent}</div>
                        <div className="truncate text-[11px] text-[--muted-foreground]">{item.action}</div>
                      </div>
                      <span className="shrink-0 text-[10px] text-[--muted-foreground]">
                        {formatDistanceToNow(time, { addSuffix: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({
  label, value, sub, icon: Icon, accent, trend,
}: {
  label: string; value: number; sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string; trend: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: accent + "18" }}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1 text-[10px] text-emerald-400">
            <TrendingUp className="w-3 h-3" />
            {trend}
          </div>
        </div>
        <div className="text-2xl font-bold text-[--foreground]">{value}</div>
        <div className="text-xs text-[--muted-foreground] mt-0.5">{label}</div>
        <div className="text-[11px] text-[--muted-foreground] mt-1 opacity-70">{sub}</div>
      </CardContent>
    </Card>
  );
}

function AgentRow({ agent }: { agent: import("@/types").Agent }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[--border] last:border-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
        style={{ backgroundColor: agent.color + "22" }}
      >
        {agent.avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[--foreground] truncate">{agent.name}</span>
          <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 hidden sm:inline-flex">
            {agent.model}
          </Badge>
        </div>
        <div className="text-xs text-[--muted-foreground] truncate">{agent.role}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[agent.status] }} />
        <span className="text-xs text-[--muted-foreground]">
          {{ online: "Online", busy: "Running", idle: "Idle", offline: "Offline" }[agent.status]}
        </span>
      </div>
    </div>
  );
}

function StatusRow({ label, status, latency }: { label: string; status: "operational" | "degraded" | "down"; latency: string }) {
  const cfg = {
    operational: { color: "text-emerald-400", dot: "bg-emerald-400", label: "OK" },
    degraded:    { color: "text-amber-400",   dot: "bg-amber-400",   label: "Degraded" },
    down:        { color: "text-red-400",     dot: "bg-red-400",     label: "Down" },
  }[status];
  return (
    <div className="flex items-center gap-2">
      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
      <span className="text-xs text-[--foreground] flex-1">{label}</span>
      <span className="text-[10px] text-[--muted-foreground]">{latency}</span>
      <span className={cn("text-[10px] font-medium", cfg.color)}>{cfg.label}</span>
    </div>
  );
}

function ResourceBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[--foreground]">{label}</span>
        <span className="text-xs text-[--muted-foreground]">{value}%</span>
      </div>
      <Progress value={value} className="h-1.5" style={{ "--progress-color": color } as React.CSSProperties} />
    </div>
  );
}
