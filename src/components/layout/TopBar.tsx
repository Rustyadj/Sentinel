"use client";

import {
  Bell,
  ChevronDown,
  Lightbulb,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/useAgentStore";
import { useAppStore } from "@/store/useAppStore";

export function TopBar() {
  const router = useRouter();
  const { setCommandBarOpen } = useAppStore();
  const { agents } = useAgentStore();
  const { data: session } = useSession();
  const busyAgents = agents.filter((agent) => agent.status === "busy");
  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "R";

  return (
    <header className="relative z-50 flex h-16 shrink-0 items-center border-b border-[#202937] bg-[#080c13]/95 px-3 shadow-[0_12px_40px_rgba(0,0,0,.24)] backdrop-blur-xl">
      <button
        onClick={() => router.push("/")}
        className="group flex h-full w-auto shrink-0 items-center gap-3 px-2 md:w-60"
        aria-label="Sentinel OS home"
      >
        <span className="relative grid h-9 w-9 place-items-center">
          <span className="absolute inset-0 rounded-xl bg-violet-500/15 blur-md transition group-hover:bg-violet-500/25" />
          <span className="relative grid h-9 w-9 place-items-center rounded-xl border border-violet-400/25 bg-[#111827] text-violet-300">
            <ShieldCheck className="h-5 w-5" />
          </span>
        </span>
        <span className="hidden items-baseline gap-1.5 sm:flex">
          <span className="text-[15px] font-black tracking-[0.08em] text-white">
            SENTINEL
          </span>
          <span className="text-[10px] font-bold tracking-[0.2em] text-violet-300">
            OS
          </span>
        </span>
      </button>

      <button
        onClick={() => setCommandBarOpen(true)}
        className="mx-auto flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border border-[#2a3444] bg-[#0d131c] px-3 text-xs text-slate-400 shadow-inner transition hover:border-violet-400/45 hover:text-slate-200"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Search Sentinel OS...</span>
        <kbd className="hidden rounded-md border border-[#2a3444] bg-[#151c27] px-1.5 py-0.5 font-mono text-[10px] text-slate-400 sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-3 flex shrink-0 items-center gap-1.5">
        {busyAgents.length > 0 && (
          <div className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-2.5 py-1 text-[10px] text-emerald-300 lg:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {busyAgents.length} live
          </div>
        )}
        <Button
          size="sm"
          className="hidden h-8 gap-1.5 border border-violet-300/20 bg-violet-600 px-3 text-xs text-white shadow-[0_0_24px_rgba(124,58,237,.22)] hover:bg-violet-500 md:flex"
        >
          <Zap className="h-3.5 w-3.5" />
          Quick Actions
        </Button>
        <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex">
          <Lightbulb className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex">
          <MessageCircle className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet-400" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 md:hidden">
          <Plus className="h-4 w-4" />
        </Button>
        <button
          onClick={() => router.push("/settings")}
          className="ml-1 flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-white/5"
          title="Settings"
        >
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? "User"}
              className="h-8 w-8 rounded-full border border-[#334155]"
            />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full border border-violet-400/20 bg-violet-400/10 text-[10px] font-bold text-violet-200">
              {initials}
            </span>
          )}
          <span className="hidden text-left lg:block">
            <span className="block max-w-24 truncate text-xs font-semibold text-slate-100">
              {user?.name?.split(" ")[0] ?? "Rusty"}
            </span>
            <span className="block text-[9px] text-slate-500">Administrator</span>
          </span>
          <ChevronDown className="hidden h-3 w-3 text-slate-500 lg:block" />
        </button>
      </div>
    </header>
  );
}
