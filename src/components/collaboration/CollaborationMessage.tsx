"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  GitPullRequestArrow,
  ListChecks,
  MessageSquareText,
  TerminalSquare,
  UserRoundCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentActivityEntry } from "@/store/useCollaborationStore";
import type {
  AgentMessage,
  AgentMessageType,
  CollaborationArtifact,
  CollaborationParticipant,
  CollaborationTask,
} from "@/types/collaboration";

const TYPE_STYLE: Record<AgentMessageType, { label: string; className: string; icon: typeof MessageSquareText }> = {
  MESSAGE: { label: "Message", className: "border-white/[0.07] bg-white/[0.025]", icon: MessageSquareText },
  DELEGATION: { label: "Delegation", className: "border-cyan-400/25 bg-cyan-400/[0.055]", icon: ArrowDownToLine },
  REVIEW_REQUEST: { label: "Review requested", className: "border-amber-400/25 bg-amber-400/[0.05]", icon: GitPullRequestArrow },
  QUESTION: { label: "Question", className: "border-sky-400/25 bg-sky-400/[0.05]", icon: MessageSquareText },
  ANSWER: { label: "Answer", className: "border-emerald-400/20 bg-emerald-400/[0.045]", icon: CheckCircle2 },
  BLOCKER: { label: "Blocker", className: "border-red-400/25 bg-red-400/[0.055]", icon: ListChecks },
  DECISION: { label: "Decision", className: "border-violet-400/25 bg-violet-400/[0.055]", icon: UserRoundCheck },
  RESULT: { label: "Result", className: "border-emerald-400/20 bg-emerald-400/[0.045]", icon: CheckCircle2 },
  CHANGES_REQUESTED: { label: "Changes requested", className: "border-rose-400/25 bg-rose-400/[0.055]", icon: GitPullRequestArrow },
};

const ROLE_LABEL = { lead: "Lead", implementation: "Implementation", review: "Review", research: "Research" } as const;

function clock(at: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(at));
}

export function CollaborationMessage({
  message,
  participants,
  tasks,
  artifacts,
  activity,
  onOpenTask,
  onOpenArtifact,
}: {
  message: AgentMessage;
  participants: CollaborationParticipant[];
  tasks: CollaborationTask[];
  artifacts: CollaborationArtifact[];
  activity: AgentActivityEntry[];
  onOpenTask: (taskId: string) => void;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const isUser = message.senderAgentId === "user";
  const sender = isUser ? null : participants.find((participant) => participant.agentId === message.senderAgentId);
  const task = message.taskId ? tasks.find((item) => item.id === message.taskId) : null;
  const linkedArtifacts = artifacts.filter((artifact) => message.artifactIds?.includes(artifact.id));
  const entries = activity.filter((entry) => entry.agentId === message.senderAgentId && (!message.taskId || entry.taskId === message.taskId));
  const treatment = TYPE_STYLE[message.type];
  const TypeIcon = treatment.icon;

  return (
    <article className={cn("group rounded-xl border p-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.14)]", treatment.className, isUser && "ml-auto max-w-[82%] border-indigo-400/25 bg-indigo-500/[0.09]")}>
      <div className="flex items-start gap-2.5">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[9px] font-semibold", isUser ? "border-indigo-300/20 bg-indigo-400/10 text-indigo-200" : "border-white/10 bg-[#111c29] text-[#dce6f1]")}>
          {isUser ? "YOU" : sender?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "AI"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11.5px] font-semibold text-[#eef4f8]">{isUser ? "You" : sender?.name ?? "Agent"}</span>
            {sender ? <span className="rounded border border-white/[0.07] px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.14em] text-[#7f91a7]">{ROLE_LABEL[sender.role]}</span> : null}
            <span className="ml-auto text-[9px] text-[#607087]">{clock(message.createdAt)}</span>
          </div>
          {task ? (
            <button type="button" onClick={() => onOpenTask(task.id)} className="mt-1 flex items-center gap-1 text-[9.5px] text-cyan-300/75 outline-none hover:text-cyan-200 focus-visible:ring-1 focus-visible:ring-cyan-300/50">
              Working on {task.id} · {task.title}
              <ChevronRight className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.13em] text-[#8fa0b4]">
        <TypeIcon className="h-3 w-3" />
        {treatment.label}
        {sender ? <span className="ml-auto normal-case tracking-normal text-[#64748b]">{sender.status}</span> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[12px] leading-[1.65] text-[#ced8e4]">{message.content}</p>

      {linkedArtifacts.length > 0 || task ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {linkedArtifacts.map((artifact) => (
            <button key={artifact.id} type="button" onClick={() => onOpenArtifact(artifact.id)} className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-black/15 px-2 py-1 text-[9.5px] text-[#a9b7c8] outline-none hover:border-cyan-300/30 hover:text-cyan-200 focus-visible:ring-1 focus-visible:ring-cyan-300/50">
              <FileCode2 className="h-3 w-3" />
              {artifact.type === "code_diff" ? "View Diff" : "Review"}
            </button>
          ))}
          {task ? (
            <button type="button" onClick={() => onOpenTask(task.id)} className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-black/15 px-2 py-1 text-[9.5px] text-[#a9b7c8] outline-none hover:border-cyan-300/30 hover:text-cyan-200 focus-visible:ring-1 focus-visible:ring-cyan-300/50">
              <ListChecks className="h-3 w-3" />
              Open Task
            </button>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="mt-3 border-t border-white/[0.06] pt-2">
          <button type="button" onClick={() => setTerminalOpen((open) => !open)} aria-expanded={terminalOpen} className="flex items-center gap-1.5 text-[9.5px] text-[#73859a] outline-none hover:text-[#b4c1d0] focus-visible:ring-1 focus-visible:ring-cyan-300/50">
            <ChevronRight className={cn("h-3 w-3 transition-transform", terminalOpen && "rotate-90")} />
            <TerminalSquare className="h-3 w-3" />
            Terminal · {entries.length} events
          </button>
          {terminalOpen ? (
            <div className="mt-2 space-y-1 rounded-lg border border-white/[0.06] bg-black/25 p-2.5 font-mono text-[9.5px] leading-relaxed text-[#8fa1b6]">
              {entries.map((entry) => <div key={entry.id}><span className="text-cyan-300/60">{clock(entry.at)}</span> {entry.action}{entry.detail ? ` — ${entry.detail}` : ""}</div>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
