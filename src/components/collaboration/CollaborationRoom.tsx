"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Command,
  Hand,
  Network,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  UserRoundCog,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApprovalCard, DisagreementCard } from "./CollaborationCards";
import { CollaborationComposer } from "./CollaborationComposer";
import { CollaborationLane } from "./CollaborationLane";
import { CollaborationMessage } from "./CollaborationMessage";
import { CollaborationOverlays } from "./CollaborationOverlays";
import { CollaborationParticipantBar } from "./CollaborationParticipantBar";
import { useCollaborationGraphHighlights } from "./useCollaborationGraphHighlights";
import { useCollaborationRoom } from "./useCollaborationRoom";

export function CollaborationRoom() {
  const room = useCollaborationRoom();
  const setLaneOpen = room.setLaneOpen;
  const highlightedTitles = useCollaborationGraphHighlights(room);
  const [inspectionApprovalId, setInspectionApprovalId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inspectionApproval = room.approvals.find((approval) => approval.id === inspectionApprovalId) ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [room.commandResults.length, room.messages.length]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compactLayout = window.matchMedia("(max-width: 1023px)");
    const closeLaneForCompactLayout = () => {
      if (compactLayout.matches) setLaneOpen(false);
    };
    closeLaneForCompactLayout();
    compactLayout.addEventListener("change", closeLaneForCompactLayout);
    return () => compactLayout.removeEventListener("change", closeLaneForCompactLayout);
  }, [setLaneOpen]);

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[#03070d] text-[#e8eef5]">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="Collaboration room">
        <RoomHeader room={room} />
        <CollaborationParticipantBar
          participants={room.participants}
          workspace={room.workspace}
          selectedParticipantId={room.selectedParticipantId}
          onSelect={room.setSelectedParticipantId}
        />
        <HumanControlBar room={room} />

        <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_22%_0%,rgba(34,211,238,0.045),transparent_32%),linear-gradient(180deg,#050b13,#03070d)] px-3 py-4 sm:px-5 lg:px-7" role="log" aria-label="Collaboration messages" aria-live="polite">
          <div className="mx-auto max-w-3xl space-y-3">
            <div className="mb-5 flex items-center gap-3 text-[9px] uppercase tracking-[0.17em] text-[#5f7187]"><span className="h-px flex-1 bg-white/[0.06]" />Room opened · Hermes supervising<span className="h-px flex-1 bg-white/[0.06]" /></div>
            {room.messages.map((message) => (
              <CollaborationMessage
                key={message.id}
                message={message}
                participants={room.participants}
                tasks={room.tasks}
                artifacts={room.artifacts}
                activity={room.activity}
                onOpenTask={room.setSelectedTaskId}
                onOpenArtifact={room.setSelectedArtifactId}
              />
            ))}

            {room.disagreements.map((disagreement) => (
              <DisagreementCard
                key={disagreement.id}
                disagreement={disagreement}
                participants={room.participants}
                onChoose={(agentId) => room.resolveDisagreement(disagreement.id, agentId)}
                onAskLead={() => room.sendMessage(`Resolve disagreement ${disagreement.id}: ${disagreement.issue}`, ["hermes"], "QUESTION")}
              />
            ))}

            {room.approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onApprove={() => room.approve(approval.id)}
                onDeny={() => room.deny(approval.id)}
                onInspect={() => setInspectionApprovalId(approval.id)}
              />
            ))}

            {room.commandResults.map((result) => (
              <section key={result.id} className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-3.5" aria-label={`${result.command} result`}>
                <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-200/75"><Command className="h-3.5 w-3.5" /> {result.command}</div>
                <div className="mt-2 text-[11.5px] font-medium text-[#dce6ef]">{result.title}</div>
                <div className="mt-1 text-[10px] leading-relaxed text-[#8294aa]">{result.detail}</div>
              </section>
            ))}
            <div ref={endRef} />
          </div>
        </div>
        <CollaborationComposer room={room} />
      </main>

      {room.laneOpen ? (
        <>
          <button type="button" aria-label="Close collaboration lane" onClick={() => room.setLaneOpen(false)} className="absolute inset-0 z-30 bg-black/50 lg:hidden" />
          <div className="absolute inset-y-0 right-0 z-40 lg:relative lg:z-auto"><CollaborationLane room={room} /></div>
        </>
      ) : null}

      <CollaborationOverlays room={room} highlightedTitles={highlightedTitles} inspectionApproval={inspectionApproval} onCloseInspection={() => setInspectionApprovalId(null)} />
    </div>
  );
}

function RoomHeader({ room }: { room: ReturnType<typeof useCollaborationRoom> }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#050b13] px-4">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-300/[0.055]"><Network className="h-3.5 w-3.5 text-cyan-300" /></div>
      <div className="min-w-0"><h1 className="truncate text-[11.5px] font-semibold text-[#edf3f8]">{room.roomName}</h1><div className="flex items-center gap-1.5 text-[8.5px] text-[#65778d]"><span className={cn("h-1.5 w-1.5 rounded-full", room.paused ? "bg-amber-400" : "bg-emerald-400")} />{room.paused ? "Paused by operator" : "Live · local event bridge"}</div></div>
      <div className="ml-auto hidden items-center gap-1.5 text-[9px] text-[#64758a] sm:flex"><span className="rounded border border-white/[0.07] bg-white/[0.025] px-2 py-1 capitalize">{room.mode}</span><span className="rounded border border-white/[0.07] bg-white/[0.025] px-2 py-1">{room.tasks.length} tasks</span></div>
      <button type="button" onClick={() => room.setCommandPaletteOpen(true)} aria-label="Open command palette" title="Command palette (Ctrl K)" className="flex h-7 items-center gap-1.5 rounded-md border border-white/[0.07] px-2 text-[9px] text-[#7d8fa5] outline-none hover:bg-white/[0.05] hover:text-white focus-visible:ring-1 focus-visible:ring-cyan-300/50"><Command className="h-3 w-3" /><span className="hidden sm:inline">Ctrl K</span></button>
      {!room.laneOpen ? <button type="button" onClick={() => room.setLaneOpen(true)} aria-label="Open collaboration lane" className="rounded-md p-1.5 text-[#7d8fa5] outline-none hover:bg-white/[0.05] hover:text-white focus-visible:ring-1 focus-visible:ring-cyan-300/50"><PanelRightOpen className="h-3.5 w-3.5" /></button> : null}
    </header>
  );
}

function HumanControlBar({ room }: { room: ReturnType<typeof useCollaborationRoom> }) {
  const activeTask = room.tasks.find((task) => task.status === "RUNNING") ?? room.tasks[0];
  const busyAgent = room.participants.find((participant) => participant.health === "BUSY") ?? room.participants[0];
  const pendingApproval = room.pendingApprovals[0];
  const nextOwner = room.participants.find((participant) => participant.agentId !== activeTask?.ownerAgentId);
  const controls = [
    { label: room.paused ? "Resume" : "Pause All", icon: room.paused ? Play : Pause, run: () => room.setPaused(!room.paused) },
    { label: "Cancel Task", icon: Square, run: () => { if (activeTask) room.cancelTask(activeTask.id); } },
    { label: "Reassign", icon: RefreshCw, run: () => { if (activeTask && nextOwner) room.reassignTask(activeTask.id, nextOwner.agentId); } },
    { label: "Take Control", icon: Hand, run: () => { room.setMode("solo"); room.setSoloAgentId("hermes"); room.addCommandResult({ command: "take-control", title: "Operator control enabled", detail: "New messages route through the selected solo agent until collaboration mode is restored." }); } },
    { label: "Approve", icon: Check, run: () => { if (pendingApproval) room.approve(pendingApproval.id); } },
    { label: "Reject", icon: X, run: () => { if (pendingApproval) room.deny(pendingApproval.id); } },
    { label: "Stop Agent", icon: UserRoundCog, run: () => { if (busyAgent) room.stopAgent(busyAgent.agentId); } },
  ];
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#050b13] px-3 py-1.5" aria-label="Human controls">
      <span className="mr-1 flex shrink-0 items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.15em] text-[#65778d]"><ShieldCheck className="h-3 w-3 text-cyan-300/65" /> Human control</span>
      {controls.map(({ label, icon: Icon, run }) => <button key={label} type="button" onClick={run} className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-white/[0.065] bg-white/[0.02] px-2 text-[8.5px] text-[#8091a6] outline-none hover:border-cyan-300/18 hover:text-[#d3dde7] focus-visible:ring-1 focus-visible:ring-cyan-300/50"><Icon className="h-2.5 w-2.5" />{label}</button>)}
    </div>
  );
}
