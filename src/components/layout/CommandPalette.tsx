"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command, defaultFilter } from "cmdk";
import {
  Bot,
  Brain,
  CheckSquare,
  Home,
  ListChecks,
  MessageSquare,
  Network,
  Search,
  Settings,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaletteCommand {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
}

interface VpsAgentSummary {
  id: string;
  name: string;
  kind: string;
  description: string;
  model: string;
}

const NAVIGATION_COMMANDS: PaletteCommand[] = [
  { label: "Home", description: "Open Mission Control", href: "/", icon: Home, keywords: ["dashboard", "mission control"] },
  { label: "Chat", description: "Open the collaboration room", href: "/chat", icon: MessageSquare, keywords: ["room", "conversation", "message"] },
  { label: "Agents", description: "Review connected agents", href: "/agents", icon: Bot, keywords: ["workers", "runtimes"] },
  { label: "Tasks", description: "Open the task queue", href: "/tasks", icon: CheckSquare, keywords: ["work", "queue", "todo"] },
  { label: "Workspaces", description: "Browse operational workspaces", href: "/workspaces", icon: Workflow, keywords: ["projects", "spaces"] },
  { label: "Memory", description: "Open shared memory", href: "/memory", icon: Brain, keywords: ["knowledge", "context"] },
  { label: "Graph", description: "Open the knowledge graph", href: "/chat?space=graph", icon: Network, keywords: ["neural lens", "nodes", "relationships"] },
  { label: "Settings", description: "Configure Sentinel", href: "/settings", icon: Settings, keywords: ["preferences", "configuration"] },
];

const ACTION_COMMANDS: PaletteCommand[] = [
  { label: "Review task queue", description: "Find current work and follow-ups", href: "/tasks", icon: ListChecks, keywords: ["search", "find", "tasks", "action"] },
  { label: "Check agent status", description: "Inspect connected runtimes", href: "/agents", icon: Users, keywords: ["health", "online", "agents", "action"] },
  { label: "Open knowledge graph", description: "Inspect connected operational context", href: "/chat?space=graph", icon: Sparkles, keywords: ["graph", "context", "action"] },
];

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"));
}

function rankCommand(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;

  const label = value.toLowerCase();
  if (label === query) return 1;
  if (label.startsWith(query)) return 0.99;
  if (label.includes(query)) return 0.92;

  const normalizedKeywords = keywords?.map((keyword) => keyword.toLowerCase()) ?? [];
  if (normalizedKeywords.some((keyword) => keyword.startsWith(query))) return 0.84;
  if (normalizedKeywords.some((keyword) => keyword.includes(query))) return 0.72;

  return query.length < 3 ? defaultFilter(value, search, keywords) * 0.5 : 0;
}

function CommandRow({ command, onSelect }: { command: PaletteCommand; onSelect: (href: string) => void }) {
  const Icon = command.icon;
  return (
    <Command.Item
      value={command.label}
      keywords={[command.description, ...command.keywords]}
      onSelect={() => onSelect(command.href)}
      className="group flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left outline-none transition-colors data-[selected=true]:border-violet-400/25 data-[selected=true]:bg-white/[0.065]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.025] text-[#7f8da0] group-data-[selected=true]:border-violet-400/20 group-data-[selected=true]:text-violet-300">
        <Icon className="h-4 w-4 stroke-[1.6]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[#dfe5ed]">{command.label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-[#708096]">{command.description}</span>
      </span>
    </Command.Item>
  );
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<VpsAgentSummary[]>([]);
  const [agentsState, setAgentsState] = useState<"idle" | "ready" | "unavailable">("idle");
  const hasQuery = query.trim().length > 0;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery("");
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Open global search"]')?.focus();
      });
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (!open && isTextEntry(event.target)) return;

      event.preventDefault();
      handleOpenChange(!open);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleOpenChange, open]);

  useEffect(() => {
    if (!open || agentsState !== "idle") return;

    const controller = new AbortController();
    fetch("/api/vps/agents", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Agent request returned ${response.status}`);
        const body = (await response.json()) as VpsAgentSummary[];
        setAgents(Array.isArray(body) ? body : []);
        setAgentsState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAgents([]);
          setAgentsState("unavailable");
        }
      });

    return () => controller.abort();
  }, [agentsState, open]);

  const navigate = (href: string) => {
    handleOpenChange(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Sentinel command palette"
      loop
      filter={rankCommand}
      overlayClassName="fixed inset-0 z-[100] bg-black/70 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-24px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[#263449] bg-[#09131f] text-[#e8edf4] shadow-[0_18px_48px_rgba(0,0,0,0.32)] outline-none"
    >
      <div className="flex h-13 items-center gap-3 border-b border-white/[0.07] px-4">
        <Search className="h-4 w-4 shrink-0 stroke-[1.6] text-[#77879c]" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Navigate or run an action…"
          className="h-13 min-w-0 flex-1 bg-transparent text-[13px] text-[#edf2f7] outline-none placeholder:text-[#58687d]"
        />
        <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-1 font-mono text-[9px] text-[#68788d]">Esc</kbd>
      </div>

      <Command.List className="max-h-[min(58vh,430px)] overflow-y-auto p-2" label="Command results">
        <Command.Empty className="px-4 py-8 text-center">
          <p className="text-[11px] text-[#8190a4]">No matching command.</p>
          <button
            type="button"
            onClick={() => navigate("/tasks")}
            className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[10px] font-medium text-[#c8d1dd] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            Open Tasks
          </button>
        </Command.Empty>

        <Command.Group
          heading="Navigation"
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-[#627287]"
        >
          {NAVIGATION_COMMANDS.map((command) => (
            <CommandRow key={command.href} command={command} onSelect={navigate} />
          ))}
        </Command.Group>

        {hasQuery ? (
          <>
            <Command.Separator alwaysRender className="my-2 h-px bg-white/[0.06]" />
            <Command.Group
              heading="Agents"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-[#627287]"
            >
              {agents.map((agent) => (
                <Command.Item
                  key={agent.id}
                  value={`Talk to ${agent.name}`}
                  keywords={[agent.id, agent.kind, agent.model, agent.description, "agent", "chat"]}
                  onSelect={() => navigate(`/chat?agent=${encodeURIComponent(agent.id)}`)}
                  className="group flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left outline-none transition-colors data-[selected=true]:border-violet-400/25 data-[selected=true]:bg-white/[0.065]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.025] text-[#7f8da0] group-data-[selected=true]:border-violet-400/20 group-data-[selected=true]:text-violet-300">
                    <Bot className="h-4 w-4 stroke-[1.6]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-[#dfe5ed]">Talk to {agent.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[#708096]">{agent.model}</span>
                  </span>
                </Command.Item>
              ))}
              {agentsState === "idle" ? (
                <Command.Loading className="px-3 py-2.5 text-[10px] text-[#708096]">Loading live agents…</Command.Loading>
              ) : null}
              {agentsState === "unavailable" ? (
                <div className="px-3 py-2.5 text-[10px] normal-case tracking-normal text-[#708096]">Live agents are unavailable.</div>
              ) : null}
            </Command.Group>

            <Command.Separator alwaysRender className="my-2 h-px bg-white/[0.06]" />
            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-[#627287]"
            >
              {ACTION_COMMANDS.map((command) => (
                <CommandRow key={command.label} command={command} onSelect={navigate} />
              ))}
            </Command.Group>
          </>
        ) : null}
      </Command.List>

      <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2 text-[9px] text-[#5f6f84]">
        <span>Primary destinations appear by default</span>
        <span className="flex items-center gap-3 font-mono"><span>↑↓ Navigate</span><span>↵ Open</span></span>
      </div>
    </Command.Dialog>
  );
}
