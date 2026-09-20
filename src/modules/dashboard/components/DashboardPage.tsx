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
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useAgentStore } from "@/store/useAgentStore";
import { useMemoryStore } from "@/store/useMemoryStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { STATUS_COLORS } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";

const _D = Date.now();
const RECENT_ACTIVITY = [
  { agent: "Hermes Lisa", action: "Completed task analysis", time: new Date(_D - 2 * 60 * 1000), color: "#8B5CF6", status: "complete" },
  { agent: "Claude Code", action: "Generated Prisma schema", time: new Date(_D - 8 * 60 * 1000), color: "#3B82F6", status: "complete" },
  { agent: "Hermes Lisa", action: "Memory checkpoint saved", time: new Date(_D - 45 * 60 * 1000), color: "#8B5CF6", status: "complete" },
];

export function DashboardPage() {
  const { agents } = useAgentStore();
  const { memories } = useMemoryStore();

  const onlineAgents = agents.filter((a) => a.status === "online").length;
  const busyAgents = agents.filter((a) => a.status === "busy").length;
  const totalMemories = memories.length;
  const pinnedMemories = memories.filter((m) => m.pinned).length;

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-[--foreground]">Mission Control</h1>
        <p className="text-sm text-[--muted-foreground] mt-0.5">
          System overview · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Active Agents"
          value={onlineAgents}
          sub={`${busyAgents} running tasks`}
          icon={Bot}
          accent="#8B5CF6"
          trend="+2 today"
        />
        <StatCard
          label="Messages Today"
          value={247}
          sub="across 3 rooms"
          icon={MessageSquare}
          accent="#3B82F6"
          trend="+18%"
        />
        <StatCard
          label="Memory Entries"
          value={totalMemories}
          sub={`${pinnedMemories} pinned`}
          icon={Brain}
          accent="#10B981"
          trend="quality first"
        />
        <StatCard
          label="Tasks Completed"
          value={12}
          sub="5 pending"
          icon={CheckCircle2}
          accent="#F59E0B"
          trend="this sprint"
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Agent roster */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Agent Roster</CardTitle>
              <Link href="/agents" className="text-xs text-[--primary] flex items-center gap-1 hover:underline">
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

        {/* System status */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                System Status
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
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
            <CardContent className="pt-0 space-y-3">
              <ResourceBar label="Context Usage" value={34} color="#6366f1" />
              <ResourceBar label="Memory Capacity" value={22} color="#10B981" />
              <ResourceBar label="API Quota" value={61} color="#F59E0B" />
              <ResourceBar label="Tool Calls/hr" value={45} color="#3B82F6" />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick actions & recent */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Quick actions */}
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
                { label: "Add Memory", href: "/obsidian", icon: Brain, color: "#10B981" },
                { label: "Run Workflow", href: "/workflows", icon: Zap, color: "#F59E0B" },
              ].map(({ label, href, icon: Icon, color }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center gap-2.5 p-3 rounded-lg border border-[--border] hover:border-[--primary]/40 hover:bg-[--accent] transition-colors group"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: color + "20" }}
                  >
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <span className="text-sm text-[--foreground] group-hover:text-[--primary] transition-colors">
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[--muted-foreground]" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {RECENT_ACTIVITY.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5"
                    style={{ backgroundColor: item.color + "22" }}
                  >
                    <CheckCircle2 className="w-3 h-3" style={{ color: item.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[--foreground] truncate">
                      {item.agent}
                    </div>
                    <div className="text-[11px] text-[--muted-foreground] truncate">
                      {item.action}
                    </div>
                  </div>
                  <span className="text-[10px] text-[--muted-foreground] shrink-0">
                    {formatDistanceToNow(item.time, { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  trend,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  trend: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: accent + "18" }}
          >
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
  const statusLabel: Record<string, string> = {
    online: "Online",
    busy: "Running",
    idle: "Idle",
    offline: "Offline",
  };

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
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: STATUS_COLORS[agent.status] }}
        />
        <span className="text-xs text-[--muted-foreground]">
          {statusLabel[agent.status]}
        </span>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  status,
  latency,
}: {
  label: string;
  status: "operational" | "degraded" | "down";
  latency: string;
}) {
  const statusConfig = {
    operational: { color: "text-emerald-400", dot: "bg-emerald-400", label: "OK" },
    degraded: { color: "text-amber-400", dot: "bg-amber-400", label: "Degraded" },
    down: { color: "text-red-400", dot: "bg-red-400", label: "Down" },
  };
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", config.dot)} />
      <span className="text-xs text-[--foreground] flex-1">{label}</span>
      <span className="text-[10px] text-[--muted-foreground]">{latency}</span>
      <span className={cn("text-[10px] font-medium", config.color)}>{config.label}</span>
    </div>
  );
}

function ResourceBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[--foreground]">{label}</span>
        <span className="text-xs text-[--muted-foreground]">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[--muted] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
