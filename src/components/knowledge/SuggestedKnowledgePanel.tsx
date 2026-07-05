"use client";

import {
  Brain,
  GitBranch,
  CheckSquare,
  User,
  Link,
  Sparkles,
  X,
  Check,
} from "lucide-react";
import type { ExtractionCandidate } from "@/lib/knowledge/types";

interface SuggestedKnowledgePanelProps {
  candidates: ExtractionCandidate[];
  onAccept: (candidate: ExtractionCandidate) => void;
  onReject: (candidate: ExtractionCandidate) => void;
  onDismiss: () => void;
}

function CandidateIcon({ type }: { type: ExtractionCandidate["candidateType"] }) {
  const cls = "w-3 h-3 shrink-0";
  switch (type) {
    case "memory":
      return <Brain className={cls} />;
    case "decision":
      return <GitBranch className={cls} />;
    case "task":
      return <CheckSquare className={cls} />;
    case "entity":
      return <User className={cls} />;
    case "link":
      return <Link className={cls} />;
    default:
      return <Brain className={cls} />;
  }
}

function typeColor(type: ExtractionCandidate["candidateType"]): string {
  switch (type) {
    case "memory":
      return "text-violet-400";
    case "decision":
      return "text-amber-400";
    case "task":
      return "text-emerald-400";
    case "entity":
      return "text-sky-400";
    case "link":
      return "text-blue-400";
    default:
      return "text-[--muted-foreground]";
  }
}

export function SuggestedKnowledgePanel({
  candidates,
  onAccept,
  onReject,
  onDismiss,
}: SuggestedKnowledgePanelProps) {
  return (
    <div className="border-t border-[--border] bg-[--muted] py-2 px-4 shrink-0">
      <div className="flex items-center gap-3">
        {/* Label */}
        <div className="flex items-center gap-1.5 shrink-0 text-xs text-[--muted-foreground]">
          <Sparkles className="w-3 h-3 text-[--primary]" />
          <span>Suggested knowledge:</span>
        </div>

        {/* Scrollable chips */}
        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 w-max">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[--border] bg-[--card] text-xs group shrink-0"
              >
                {/* Type icon */}
                <span className={typeColor(c.candidateType)}>
                  <CandidateIcon type={c.candidateType} />
                </span>

                {/* Title truncated */}
                <span
                  className="text-[--foreground] max-w-[10rem] truncate"
                  title={c.title}
                >
                  {c.title.length > 24 ? c.title.slice(0, 24) + "…" : c.title}
                </span>

                {/* Confidence */}
                <span className="text-[--muted-foreground] text-[10px] tabular-nums shrink-0">
                  {Math.round(c.confidence * 100)}%
                </span>

                {/* Accept */}
                <button
                  onClick={() => onAccept(c)}
                  className="ml-0.5 p-0.5 rounded hover:bg-emerald-500/20 text-[--muted-foreground] hover:text-emerald-400 transition-colors shrink-0"
                  title="Accept — add to knowledge graph"
                >
                  <Check className="w-3 h-3" />
                </button>

                {/* Reject */}
                <button
                  onClick={() => onReject(c)}
                  className="p-0.5 rounded hover:bg-red-500/10 text-[--muted-foreground] hover:text-red-400 transition-colors shrink-0"
                  title="Reject"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Dismiss all */}
        <button
          onClick={onDismiss}
          className="shrink-0 text-[10px] text-[--muted-foreground] hover:text-[--foreground] transition-colors whitespace-nowrap"
        >
          Dismiss all
        </button>
      </div>
    </div>
  );
}
