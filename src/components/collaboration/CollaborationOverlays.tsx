"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  Archive,
  Bot,
  Clock3,
  FileCode2,
  GitPullRequestArrow,
  ListChecks,
  Network,
  Pause,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollaborationApproval } from "@/store/useCollaborationStore";
import type { CollaborationEvent, CollaborationParticipant, CollaborationTask } from "@/types/collaboration";
import type { CollaborationRoomController } from "./useCollaborationRoom";

const NeuralLens = dynamic(() => import("@/components/neural-lens/NeuralLens").then((module) => module.NeuralLens), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[11px] text-[#71839a]">Loading collaboration graph…</div>,
});

function clock(at: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(at));
}

export function CollaborationOverlays({
  room,
  highlightedTitles,
  inspectionApproval,
  onCloseInspection,
}: {
  room: CollaborationRoomController;
  highlightedTitles: string[];
  inspectionApproval: CollaborationApproval | null;
  onCloseInspection: () => void;
}) {
  const task = room.tasks.find((item) => item.id === room.selectedTaskId) ?? null;
  const artifact = room.artifacts.find((item) => item.id === room.selectedArtifactId) ?? null;
  const owner = task ? room.participants.find((participant) => participant.agentId === task.ownerAgentId) : null;
  const reviewer = task ? room.participants.find((participant) => participant.agentId === task.reviewerAgentId) : null;
  const taskEvents = task ? room.events.filter((event) => event.payload.taskId === task.id) : [];

  return (
    <>
      <DetailDialog open={Boolean(task)} onOpenChange={(open) => { if (!open) room.setSelectedTaskId(null); }} title={task?.id ?? "Task"} description="Task details and event timeline">
        {task ? <TaskDetail task={task} owner={owner} reviewer={reviewer} events={taskEvents} participants={room.participants} onCancel={() => room.cancelTask(task.id)} onReassign={(agentId) => room.reassignTask(task.id, agentId)} /> : null}
      </DetailDialog>

      <DetailDialog open={Boolean(artifact)} onOpenChange={(open) => { if (!open) room.setSelectedArtifactId(null); }} title={artifact?.title ?? "Artifact"} description="Collaboration artifact viewer">
        {artifact ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-[10px] sm:grid-cols-3"><Meta label="ID" value={artifact.id} /><Meta label="Type" value={artifact.type.replaceAll("_", " ")} /><Meta label="Task" value={artifact.taskId ?? "Unscoped"} /></div>
            <div className="overflow-hidden rounded-xl border border-[#203247] bg-[#050a11]">
              <div className="flex h-9 items-center gap-2 border-b border-white/[0.07] px-3 text-[9px] uppercase tracking-[0.14em] text-[#71839a]"><FileCode2 className="h-3.5 w-3.5 text-cyan-300/70" /> Preview</div>
              <pre className="overflow-x-auto p-4 font-mono text-[10px] leading-[1.7] text-[#9fb1c4]"><code>{artifact.type === "code_diff" ? "@@ collaboration room shell @@\n+ participant presence and routing\n+ typed task and artifact actions\n+ responsive collaboration lane\n- manually relayed agent messages" : `${artifact.title}\n\nVerified against the room contract.\nNo backend transport is required for this local artifact preview.`}</code></pre>
            </div>
          </div>
        ) : null}
      </DetailDialog>

      <DetailDialog open={Boolean(inspectionApproval)} onOpenChange={(open) => { if (!open) onCloseInspection(); }} title={inspectionApproval?.title ?? "Approval"} description="Inspect the exact action before approving">
        {inspectionApproval ? <div className="space-y-3"><div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.045] p-4"><Meta label="Command" value={inspectionApproval.command} mono /><div className="mt-3"><Meta label="Environment" value={inspectionApproval.environment} /></div><div className="mt-3"><Meta label="Risk" value={inspectionApproval.risk} /></div></div><p className="text-[10.5px] leading-relaxed text-[#7d8fa5]">This mock approval is local to the collaboration hook. The backend approval route can replace the handler without changing this inspection surface.</p></div> : null}
      </DetailDialog>

      <Dialog.Root open={room.graphOpen} onOpenChange={room.setGraphOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-4 z-50 overflow-hidden rounded-2xl border border-[#203247] bg-[#03070d] shadow-2xl outline-none sm:inset-8">
            <div className="absolute left-4 top-4 z-20 rounded-lg border border-white/[0.08] bg-[#07101b]/90 px-3 py-2 backdrop-blur-xl"><Dialog.Title className="text-[11px] font-semibold text-[#e6edf4]">Collaboration graph</Dialog.Title><Dialog.Description className="mt-0.5 text-[9px] text-[#71839a]">Active agents, tasks, artifacts, and files are highlighted.</Dialog.Description></div>
            <Dialog.Close className="absolute right-4 top-4 z-20 rounded-lg border border-white/[0.08] bg-[#07101b]/90 p-2 text-[#8fa0b4] outline-none hover:text-white focus-visible:ring-1 focus-visible:ring-cyan-300/50" aria-label="Close collaboration graph"><X className="h-4 w-4" /></Dialog.Close>
            <NeuralLens highlightTitles={highlightedTitles} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CollaborationCommandPalette room={room} />
    </>
  );
}

function DetailDialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[86vh] w-[calc(100%-24px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[#203247] bg-[#07101b] p-5 shadow-2xl outline-none"><div className="flex items-start gap-3 border-b border-white/[0.07] pb-4"><div className="min-w-0 flex-1"><Dialog.Title className="text-sm font-semibold text-[#edf3f8]">{title}</Dialog.Title><Dialog.Description className="mt-1 text-[10px] text-[#71839a]">{description}</Dialog.Description></div><Dialog.Close className="rounded-md p-1.5 text-[#71839a] outline-none hover:bg-white/[0.06] hover:text-white focus-visible:ring-1 focus-visible:ring-cyan-300/50" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close></div><div className="mt-4">{children}</div></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function TaskDetail({ task, owner, reviewer, events, participants, onCancel, onReassign }: { task: CollaborationTask; owner?: CollaborationParticipant | null; reviewer?: CollaborationParticipant | null; events: CollaborationEvent[]; participants: CollaborationParticipant[]; onCancel: () => void; onReassign: (agentId: string) => void }) {
  return (
    <div>
      <div className="text-base font-semibold text-[#edf3f8]">{task.title}</div>
      {task.description ? <p className="mt-2 text-[11px] leading-relaxed text-[#8fa0b4]">{task.description}</p> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-4"><Meta label="Status" value={task.status.replaceAll("_", " ")} /><Meta label="Owner" value={owner?.name ?? "Unassigned"} /><Meta label="Reviewer" value={reviewer?.name ?? "Unassigned"} /><Meta label="Artifacts" value={String(task.artifactIds.length)} /></div>
      <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><Meta label="Depends on" value={task.dependsOnTaskIds.join(", ") || "No dependencies"} /><div className="mt-3 flex flex-wrap items-center gap-2"><select aria-label="Reassign task" defaultValue="" onChange={(event) => { if (event.target.value) onReassign(event.target.value); }} className="h-8 rounded-md border border-white/[0.08] bg-[#0b1622] px-2 text-[9.5px] text-[#aebdcc] outline-none focus:border-cyan-300/25"><option value="" disabled>Reassign…</option>{participants.map((participant) => <option key={participant.agentId} value={participant.agentId}>{participant.name}</option>)}</select><button type="button" onClick={onCancel} className="h-8 rounded-md border border-red-300/15 px-3 text-[9.5px] text-red-200/80 outline-none hover:bg-red-400/[0.07] focus-visible:ring-1 focus-visible:ring-red-300/40">Cancel task</button></div></div>
      <div className="mt-5"><div className="flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#71839a]"><Clock3 className="h-3.5 w-3.5" /> Timeline</div><div className="mt-3 space-y-3">{events.map((event, index) => <div key={`${event.type}-${event.occurredAt}`} className="relative flex gap-3 pl-1">{index < events.length - 1 ? <span className="absolute left-[4px] top-2 h-[calc(100%+12px)] w-px bg-white/[0.08]" /> : null}<span className="relative mt-1.5 h-2 w-2 shrink-0 rounded-full border-2 border-[#07101b] bg-cyan-300" /><div><div className="text-[10.5px] text-[#c5d0dc]">{event.type.replaceAll(".", " ")}</div><div className="mt-0.5 text-[9px] text-[#64758a]">{clock(event.occurredAt)}</div></div></div>)}{events.length === 0 ? <div className="text-[10px] text-[#64758a]">No task events recorded.</div> : null}</div></div>
    </div>
  );
}

function CollaborationCommandPalette({ room }: { room: CollaborationRoomController }) {
  const commandPaletteOpen = room.commandPaletteOpen;
  const setCommandPaletteOpen = room.setCommandPaletteOpen;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandPaletteOpen(!commandPaletteOpen); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const actions = [
    { label: "Assign task", icon: Plus, run: () => room.assignTask("New task from command palette", room.participants.find((participant) => participant.role === "implementation")?.agentId) },
    { label: "Add agent", icon: UserPlus, run: () => room.addCommandResult({ command: "add-agent", title: "Agent invitation staged", detail: "The backend room-membership route can complete this request." }) },
    { label: "Ask for review", icon: GitPullRequestArrow, run: () => room.sendMessage("Please review the current collaboration artifacts.", room.participants.filter((participant) => participant.role === "implementation").map((participant) => participant.agentId), "REVIEW_REQUEST") },
    { label: "Open graph", icon: Network, run: () => room.setGraphOpen(true) },
    { label: "Open task", icon: ListChecks, run: () => room.setSelectedTaskId(room.tasks[0]?.id ?? null) },
    { label: "Pause agent", icon: Pause, run: () => room.setPaused(true) },
    { label: "Change autonomy", icon: Sparkles, run: () => room.setMode(room.mode === "autonomous" ? "collaborative" : "autonomous") },
    { label: "Create approval", icon: ShieldAlert, run: () => room.addCommandResult({ command: "create-approval", title: "Approval request drafted", detail: "Review command, environment, and risk before submission." }) },
    { label: "View artifacts", icon: Archive, run: () => room.setSelectedArtifactId(room.artifacts[0]?.id ?? null) },
    { label: "Switch room", icon: Bot, run: () => room.addCommandResult({ command: "switch-room", title: "Room switcher opened", detail: "Collaboration Room is the only local fixture room." }) },
  ];

  return (
    <Command.Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} label="Collaboration command palette" overlayClassName="fixed inset-0 z-[60] bg-black/65 backdrop-blur-[2px]" contentClassName="fixed left-1/2 top-[18%] z-[61] w-[calc(100%-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-[#203247] bg-[#08121e] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4"><Search className="h-4 w-4 text-[#64758a]" /><Command.Input placeholder="Search room commands…" className="h-12 flex-1 bg-transparent text-[12px] text-[#e4ebf2] outline-none placeholder:text-[#516177]" /></div>
      <Command.List className="max-h-80 overflow-y-auto p-2"><Command.Empty className="px-3 py-8 text-center text-[10px] text-[#64758a]">No command found.</Command.Empty><Command.Group heading="Room actions" className="text-[9px] uppercase tracking-[0.14em] text-[#5f7187]">{actions.map((action) => <Command.Item key={action.label} value={action.label} onSelect={() => { action.run(); setCommandPaletteOpen(false); }} className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[11px] normal-case tracking-normal text-[#b8c5d2] outline-none data-[selected=true]:bg-cyan-300/[0.07] data-[selected=true]:text-cyan-100"><action.icon className="h-3.5 w-3.5 text-cyan-300/65" />{action.label}</Command.Item>)}</Command.Group></Command.List>
      <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2 text-[8.5px] text-[#53647a]"><span>Navigate with ↑ ↓</span><span>Ctrl K</span></div>
    </Command.Dialog>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="text-[8.5px] uppercase tracking-[0.13em] text-[#64758a]">{label}</div><div className={cn("mt-1 break-words text-[10px] text-[#c0ccd8]", mono && "font-mono")}>{value}</div></div>;
}
