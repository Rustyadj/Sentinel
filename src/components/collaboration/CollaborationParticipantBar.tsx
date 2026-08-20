"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Activity, Bot, Clock3, Cpu, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollaborationParticipant } from "@/types/collaboration";

const HEALTH_COLOR: Record<CollaborationParticipant["health"], string> = {
  CONNECTED: "bg-emerald-400",
  IDLE: "bg-sky-400",
  BUSY: "bg-amber-400",
  DEGRADED: "bg-orange-400",
  DISCONNECTED: "bg-slate-500",
  FAILED: "bg-red-400",
};

const ROLE_LABEL: Record<CollaborationParticipant["role"], string> = {
  lead: "Lead",
  implementation: "Implementation",
  review: "Review",
  research: "Research",
};

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function permissionLabel(role: CollaborationParticipant["role"]): string {
  if (role === "lead") return "Delegate, decide, pause, request approval";
  if (role === "review") return "Read, review, request changes, approve artifacts";
  if (role === "implementation") return "Read, edit, test, create artifacts";
  return "Read, search, create research artifacts";
}

export function CollaborationParticipantBar({
  participants,
  workspace,
  selectedParticipantId,
  onSelect,
}: {
  participants: CollaborationParticipant[];
  workspace: string;
  selectedParticipantId: string | null;
  onSelect: (agentId: string | null) => void;
}) {
  const selected = participants.find((participant) => participant.agentId === selectedParticipantId) ?? null;

  return (
    <>
      <div className="flex min-h-16 shrink-0 items-center gap-3 overflow-x-auto border-b border-white/[0.07] bg-[#07101b]/94 px-4 py-2.5" aria-label="Collaboration participants">
        <div className="mr-1 hidden min-w-[108px] sm:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#708198]">Room team</div>
          <div className="mt-0.5 text-[11px] text-[#9ca9ba]">{participants.length} agents connected</div>
        </div>
        {participants.map((participant) => (
          <button
            key={participant.agentId}
            type="button"
            onClick={() => onSelect(participant.agentId)}
            aria-label={`Open ${participant.name} information`}
            className="group flex min-w-[142px] items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-left outline-none transition-colors hover:border-cyan-300/25 hover:bg-cyan-300/[0.035] focus-visible:ring-2 focus-visible:ring-cyan-300/50"
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#111c2a] text-[10px] font-semibold text-[#dce6f1]">
              {initials(participant.name)}
              <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#07101b]", HEALTH_COLOR[participant.health])} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-medium text-[#edf3f8]">{participant.name}</span>
              <span className="block truncate text-[9.5px] text-[#7f91a7]">{ROLE_LABEL[participant.role]} · {participant.status}</span>
            </span>
          </button>
        ))}
      </div>

      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => { if (!open) onSelect(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-[390px] border-l border-[#1b2c40] bg-[#07101b] p-5 shadow-[-24px_0_80px_rgba(0,0,0,0.45)] outline-none">
            {selected ? (
              <>
                <div className="flex items-start gap-3 border-b border-white/[0.07] pb-5">
                  <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/[0.06] text-xs font-semibold text-cyan-100">
                    {initials(selected.name)}
                    <span className={cn("absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#07101b]", HEALTH_COLOR[selected.health])} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="text-base font-semibold text-[#f1f5f9]">{selected.name}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-[11px] text-[#8393a8]">{ROLE_LABEL[selected.role]} agent · {selected.status}</Dialog.Description>
                  </div>
                  <Dialog.Close className="rounded-md p-1.5 text-[#718096] outline-none hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/50" aria-label="Close agent information">
                    <X className="h-4 w-4" />
                  </Dialog.Close>
                </div>

                <dl className="mt-5 space-y-4 text-[11px]">
                  <Info icon={Cpu} label="Runtime" value={selected.runtime} mono />
                  <Info icon={Bot} label="Model" value={selected.model} mono />
                  <Info icon={Activity} label="Health" value={selected.health} />
                  <Info icon={ShieldCheck} label="Permissions" value={permissionLabel(selected.role)} />
                  <Info icon={Clock3} label="Last activity" value={new Date(selected.lastActivityAt).toLocaleString()} />
                </dl>

                <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="uppercase tracking-[0.15em] text-[#718096]">Context usage</span>
                    <span className="font-mono text-[#aebdd0]">{selected.tokenUsage?.tokens.toLocaleString() ?? "—"} tokens</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full w-[34%] rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />
                  </div>
                  <div className="mt-2 flex justify-between text-[9.5px] text-[#64748b]">
                    <span>{selected.tokenUsage ? `$${selected.tokenUsage.costUsd.toFixed(2)} this room` : "Cost unavailable"}</span>
                    <span>272k context</span>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-[11px]">
                  <div className="text-[9.5px] uppercase tracking-[0.15em] text-[#718096]">Workspace</div>
                  <div className="mt-1.5 break-words font-mono text-[10.5px] leading-relaxed text-[#b9c5d4]">{workspace}</div>
                  <div className="mt-3 text-[9.5px] uppercase tracking-[0.15em] text-[#718096]">Active task</div>
                  <div className="mt-1 text-[#dce6f1]">{selected.activeTaskId ?? "No active task"}</div>
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Info({ icon: Icon, label, value, mono = false }: { icon: typeof Cpu; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300/70" />
      <div className="min-w-0 flex-1">
        <dt className="text-[9.5px] uppercase tracking-[0.14em] text-[#64748b]">{label}</dt>
        <dd className={cn("mt-1 break-words text-[#c7d2df]", mono && "font-mono text-[10px]")}>{value}</dd>
      </div>
    </div>
  );
}
