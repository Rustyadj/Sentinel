"use client";

import { useMemo, useRef, useState } from "react";
import { AtSign, Bot, Check, ChevronDown, Paperclip, Send, Slash, Users, X } from "lucide-react";
import type { CollaborationMode } from "@/types/collaboration";
import type { CollaborationRoomController } from "./useCollaborationRoom";

export const SLASH_COMMANDS = [
  "/assign", "/review", "/plan", "/status", "/tasks", "/agents",
  "/decisions", "/artifacts", "/graph", "/approve", "/pause", "/resume", "/cancel",
] as const;

export function parseSlashCommand(value: string): { command: string; args: string } | null {
  const match = value.trim().match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { command: `/${match[1].toLowerCase()}`, args: match[2]?.trim() ?? "" };
}

function resultDetail(command: string, room: CollaborationRoomController): string {
  if (command === "/status") return `${room.activeParticipants.length} active agents · ${room.tasks.filter((task) => task.status === "RUNNING").length} running tasks · ${room.pendingApprovals.length} approval pending`;
  if (command === "/tasks") return room.tasks.map((task) => `${task.id} ${task.status}: ${task.title}`).join(" · ");
  if (command === "/agents") return room.participants.map((participant) => `${participant.name} — ${participant.status}`).join(" · ");
  if (command === "/decisions") return room.decisions.map((decision) => decision.decision).join(" · ") || "No decisions recorded";
  if (command === "/artifacts") return room.artifacts.map((artifact) => `${artifact.id} ${artifact.title}`).join(" · ") || "No artifacts created";
  return "Command dispatched to the collaboration room.";
}

function runCommand(command: string, args: string, room: CollaborationRoomController): void {
  const runningTask = room.tasks.find((task) => task.status === "RUNNING") ?? room.tasks[0];
  if (command === "/assign") {
    const title = args || "New collaboration task";
    const owner = room.mode === "solo" ? room.soloAgentId : room.participants.find((participant) => participant.role === "implementation")?.agentId;
    room.assignTask(title, owner);
    room.addCommandResult({ command, title: "Task assigned", detail: `${title}${owner ? ` · routed to ${room.participants.find((participant) => participant.agentId === owner)?.name ?? owner}` : ""}` });
    return;
  }
  if (command === "/graph") {
    room.setGraphOpen(true);
    room.addCommandResult({ command, title: "Graph opened", detail: "Active collaboration nodes are brightened; unrelated regions remain dimmed." });
    return;
  }
  if (command === "/approve") {
    const pending = room.pendingApprovals[0];
    if (pending) room.approve(pending.id);
    room.addCommandResult({ command, title: pending ? "Approval granted" : "Nothing to approve", detail: pending?.title ?? "No pending approval requests in this room." });
    return;
  }
  if (command === "/pause" || command === "/resume") {
    const paused = command === "/pause";
    room.setPaused(paused);
    room.addCommandResult({ command, title: paused ? "Room paused" : "Room resumed", detail: paused ? "Agents will retain state but stop accepting new work." : "Agents may continue queued collaboration tasks." });
    return;
  }
  if (command === "/cancel") {
    if (runningTask) room.cancelTask(runningTask.id);
    room.addCommandResult({ command, title: runningTask ? `${runningTask.id} cancelled` : "No task cancelled", detail: runningTask?.title ?? "No active task was available." });
    return;
  }
  if (command === "/review") {
    // No participant is permanently "the reviewer" — target whichever
    // implementation worker didn't own the running task, or broadcast to
    // every implementation worker if that can't be determined.
    const implementers = room.participants.filter((participant) => participant.role === "implementation");
    const reviewer = implementers.find((participant) => participant.agentId !== runningTask?.ownerAgentId);
    const targets = reviewer ? [reviewer.agentId] : implementers.map((participant) => participant.agentId);
    room.sendMessage(args || `Please review ${runningTask?.id ?? "the current work"}.`, targets, "REVIEW_REQUEST");
    room.addCommandResult({ command, title: "Review requested", detail: args || runningTask?.title || "Current room work" });
    return;
  }
  if (command === "/plan") {
    const lead = room.participants.find((participant) => participant.role === "lead")?.agentId ?? "hermes-lisa";
    room.sendMessage(args || "Create a plan for the current room objective.", [lead], "QUESTION");
    room.addCommandResult({ command, title: "Planning request sent", detail: args || "The lead agent will plan the current objective." });
    return;
  }
  room.addCommandResult({ command, title: `${command.slice(1)} result`, detail: resultDetail(command, room) });
}

export function CollaborationComposer({ room }: { room: CollaborationRoomController }) {
  const [input, setInput] = useState("");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentionMatch = input.match(/(?:^|\s)@([\w-]*)$/i);
  const slashQuery = input.startsWith("/") ? input.slice(1).split(/\s/)[0].toLowerCase() : null;
  const mentionOptions = useMemo(() => {
    const query = mentionMatch?.[1].toLowerCase() ?? "";
    return mentionMatch ? room.participants.filter((participant) => participant.name.toLowerCase().includes(query) || participant.agentId.includes(query)) : [];
  }, [mentionMatch, room.participants]);
  const commandOptions = slashQuery === null ? [] : SLASH_COMMANDS.filter((command) => command.slice(1).startsWith(slashQuery));
  const effectiveRecipientIds = room.mode === "solo" ? [room.soloAgentId] : recipientIds.length > 0 ? recipientIds : room.participants.map((participant) => participant.agentId);

  function addMention(agentId: string, name: string) {
    const at = input.lastIndexOf("@");
    setInput(`${input.slice(0, at)}@${name} `);
    setRecipientIds((current) => current.includes(agentId) ? current : [...current, agentId]);
  }

  function send() {
    const value = input.trim();
    if (!value) return;
    const parsed = parseSlashCommand(value);
    if (parsed && SLASH_COMMANDS.includes(parsed.command as (typeof SLASH_COMMANDS)[number])) runCommand(parsed.command, parsed.args, room);
    else room.sendMessage(value, effectiveRecipientIds);
    setInput("");
    setAttachments([]);
    if (room.mode !== "solo") setRecipientIds([]);
  }

  return (
    <footer className="relative shrink-0 border-t border-white/[0.07] bg-[#060d17]/96 p-3">
      {mentionOptions.length > 0 ? (
        <SuggestionMenu label="Mention an agent">
          {mentionOptions.map((participant) => <Suggestion key={participant.agentId} label={participant.name} detail={`${participant.role} · ${participant.status}`} onClick={() => addMention(participant.agentId, participant.name)} />)}
        </SuggestionMenu>
      ) : null}
      {commandOptions.length > 0 ? (
        <SuggestionMenu label="Commands">
          {commandOptions.map((command) => <Suggestion key={command} label={command} detail="Run structured room action" onClick={() => setInput(`${command} `)} />)}
        </SuggestionMenu>
      ) : null}

      {recipientIds.length > 0 || room.mode === "solo" ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[9.5px] text-[#8293a8]">
          <span>Sent to:</span>
          {effectiveRecipientIds.map((id) => {
            const participant = room.participants.find((item) => item.agentId === id);
            return <span key={id} className="flex items-center gap-1 rounded border border-cyan-300/15 bg-cyan-300/[0.045] px-1.5 py-0.5 text-cyan-100/80">{participant?.name ?? id}{room.mode !== "solo" ? <button type="button" aria-label={`Remove ${participant?.name ?? id}`} onClick={() => setRecipientIds((current) => current.filter((item) => item !== id))}><X className="h-2.5 w-2.5" /></button> : null}</span>;
          })}
        </div>
      ) : null}

      {attachments.length > 0 ? <div className="mb-2 flex flex-wrap gap-1">{attachments.map((name) => <span key={name} className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] text-[#9dafc1]">{name}</span>)}</div> : null}

      <div className="rounded-xl border border-[#1b2c40] bg-[#0a1420] p-2 shadow-[0_12px_36px_rgba(0,0,0,0.22)] focus-within:border-cyan-300/25">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
          }}
          rows={2}
          placeholder={room.paused ? "Room is paused — resume to send" : `Message ${room.roomName}…`}
          disabled={room.paused}
          aria-label="Collaboration message"
          className="max-h-32 min-h-12 w-full resize-none bg-transparent px-1.5 py-1 text-[12px] leading-relaxed text-[#e2eaf2] outline-none placeholder:text-[#516177] disabled:opacity-50"
        />
        <div className="mt-1 flex items-center gap-1">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => setAttachments(Array.from(event.target.files ?? []).map((file) => file.name))} />
          <ComposerButton label="Attach" icon={Paperclip} onClick={() => fileRef.current?.click()} />
          <ComposerButton label="Mention" icon={AtSign} onClick={() => setInput((value) => `${value}${value && !value.endsWith(" ") ? " " : ""}@`)} />
          <ComposerButton label="Command" icon={Slash} onClick={() => setInput("/")} />
          <div className="ml-auto flex items-center gap-1.5">
            <ModeSelector mode={room.mode} onChange={room.setMode} />
            {room.mode === "solo" ? (
              <select value={room.soloAgentId} onChange={(event) => room.setSoloAgentId(event.target.value)} aria-label="Solo agent" className="h-7 rounded-md border border-white/[0.08] bg-[#0d1825] px-2 text-[9.5px] text-[#aab8c8] outline-none focus:border-cyan-300/30">
                {room.participants.map((participant) => <option key={participant.agentId} value={participant.agentId}>{participant.name}</option>)}
              </select>
            ) : null}
            <button type="button" onClick={send} disabled={!input.trim() || room.paused} aria-label="Send collaboration message" className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/85 text-[#041018] outline-none transition-colors hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/50 disabled:opacity-30"><Send className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    </footer>
  );
}

function ModeSelector({ mode, onChange }: { mode: CollaborationMode; onChange: (mode: CollaborationMode) => void }) {
  const Icon = mode === "solo" ? Bot : Users;
  return <label className="relative flex h-7 items-center gap-1 rounded-md border border-white/[0.08] bg-[#0d1825] px-2 text-[9.5px] text-[#aab8c8]"><Icon className="h-3 w-3" /><select value={mode} onChange={(event) => onChange(event.target.value as CollaborationMode)} aria-label="Collaboration mode" className="appearance-none bg-transparent pr-3 outline-none"><option value="solo">Solo</option><option value="collaborative">Collaborative</option><option value="autonomous">Autonomous</option></select><ChevronDown className="pointer-events-none absolute right-1.5 h-2.5 w-2.5" /></label>;
}

function ComposerButton({ label, icon: Icon, onClick }: { label: string; icon: typeof Paperclip; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-7 w-7 items-center justify-center rounded-md text-[#71839a] outline-none hover:bg-white/[0.06] hover:text-[#c4cfdb] focus-visible:ring-1 focus-visible:ring-cyan-300/50"><Icon className="h-3.5 w-3.5" /></button>;
}

function SuggestionMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="absolute bottom-full left-3 z-40 mb-2 w-72 overflow-hidden rounded-xl border border-[#1e3248] bg-[#0a1420]/98 p-1.5 shadow-2xl backdrop-blur-xl" role="listbox" aria-label={label}>{children}</div>;
}

function Suggestion({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
  return <button type="button" role="option" aria-selected="false" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-white/[0.055] focus-visible:bg-white/[0.055]"><span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-400/[0.08] text-cyan-300"><Check className="h-3 w-3" /></span><span><span className="block text-[10.5px] font-medium text-[#dce5ef]">{label}</span><span className="block text-[9px] text-[#687b92]">{detail}</span></span></button>;
}
