"use client";

import { useState } from "react";
import { Bot, Plus, Settings2, Zap, Brain, Shield, Globe, Code2 } from "lucide-react";
import { useAgentStore } from "@/store/useAgentStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { STATUS_COLORS } from "@/lib/constants";
import type { Agent } from "@/types";

const SKILL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  orchestration: Brain,
  planning: Zap,
  research: Globe,
  coding: Code2,
  security: Shield,
};

export default function AgentsPage() {
  const { agents, updateAgentStatus } = useAgentStore();
  const [selected, setSelected] = useState<Agent | null>(null);

  return (
    <div className="flex h-full">
      {/* Agent list */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-[--foreground]">Agent Registry</h1>
              <p className="text-sm text-[--muted-foreground] mt-0.5">
                {agents.length} agents configured · {agents.filter((a) => a.status === "online").length} online
              </p>
            </div>
            <Button size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              New Agent
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={selected?.id === agent.id}
                onClick={() => setSelected(selected?.id === agent.id ? null : agent)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Agent detail panel */}
      {selected && (
        <div className="w-72 border-l border-[--border] p-5 overflow-auto bg-[--panel] shrink-0 animate-slide-in-right">
          <AgentDetail agent={selected} onClose={() => setSelected(null)} onStatusChange={updateAgentStatus} />
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  isSelected,
  onClick,
}: {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-[--primary]/40",
        isSelected && "border-[--primary]/60 bg-[--primary]/5"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
            style={{ backgroundColor: agent.color + "22" }}
          >
            {agent.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-[--foreground]">{agent.name}</span>
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[agent.status] }}
              />
            </div>
            <div className="text-xs text-[--muted-foreground] mb-2">{agent.role}</div>
            <div className="text-[11px] text-[--muted-foreground] line-clamp-2 mb-3">
              {agent.description}
            </div>
            <div className="flex flex-wrap gap-1">
              {agent.skills.slice(0, 3).map((skill) => (
                <Badge key={skill} variant="secondary" className="text-[9px] px-1.5 py-0">
                  {skill}
                </Badge>
              ))}
              {agent.skills.length > 3 && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                  +{agent.skills.length - 3}
                </Badge>
              )}
            </div>
          </div>
          <div className="text-[10px] text-[--muted-foreground] shrink-0 text-right">
            <div className="font-mono">{agent.model}</div>
            <div className="mt-0.5 capitalize">{agent.memoryScope}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentDetail({
  agent,
  onClose,
  onStatusChange,
}: {
  agent: Agent;
  onClose: () => void;
  onStatusChange: (id: string, status: Agent["status"]) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-[--foreground]">Agent Profile</span>
        <button onClick={onClose} className="text-[--muted-foreground] hover:text-[--foreground] text-xs">
          ✕
        </button>
      </div>

      <div className="flex flex-col items-center text-center mb-5">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-3"
          style={{ backgroundColor: agent.color + "22" }}
        >
          {agent.avatar}
        </div>
        <div className="text-base font-semibold text-[--foreground]">{agent.name}</div>
        <div className="text-xs text-[--muted-foreground]">{agent.role}</div>
        <Badge
          className="mt-2 text-[10px]"
          style={{ backgroundColor: agent.color + "22", color: agent.color }}
        >
          {agent.status}
        </Badge>
      </div>

      <div className="space-y-4 text-sm">
        <section>
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Model</div>
          <div className="font-mono text-xs text-[--foreground] bg-[--muted] px-2 py-1.5 rounded">
            {agent.model}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Skills</div>
          <div className="flex flex-wrap gap-1.5">
            {agent.skills.map((skill) => (
              <Badge key={skill} variant="outline" className="text-[10px]">
                {skill}
              </Badge>
            ))}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Memory Scope</div>
          <div className="text-xs text-[--foreground] capitalize">{agent.memoryScope}</div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Tool Permissions</div>
          <div className="flex flex-wrap gap-1">
            {(agent.toolPermissions ?? []).map((perm) => (
              <Badge key={perm} variant="secondary" className="text-[9px] font-mono">
                {perm}
              </Badge>
            ))}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">System Prompt</div>
          <div className="text-[11px] text-[--muted-foreground] bg-[--muted] p-2 rounded leading-relaxed line-clamp-4">
            {agent.systemPrompt ?? "No system prompt configured."}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Set Status</div>
          <div className="flex flex-wrap gap-1.5">
            {(["online", "busy", "idle", "offline"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(agent.id, s)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] border transition-colors capitalize",
                  agent.status === s
                    ? "border-[--primary] text-[--primary] bg-[--primary]/10"
                    : "border-[--border] text-[--muted-foreground] hover:text-[--foreground]"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-5 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs">
          <Settings2 className="w-3.5 h-3.5" />
          Edit
        </Button>
        <Button size="sm" className="flex-1 gap-1.5 text-xs">
          <Zap className="w-3.5 h-3.5" />
          Activate
        </Button>
      </div>
    </div>
  );
}
