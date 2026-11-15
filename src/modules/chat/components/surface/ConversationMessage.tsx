"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

/**
 * A message, not a dashboard card. An agent's turn carries no chrome: its
 * name with its own colour, then the prose. What you wrote sits on the right
 * on a raised surface with the signal edge; what another person in a shared
 * room wrote sits on the left under their name, so whose words are whose
 * reads at a glance.
 */
export function ConversationMessage({ message, agentName, agentColor, streaming }: {
  message: Message;
  agentName?: string;
  agentColor?: string;
  streaming?: boolean;
}) {
  if (message.role === "user" && message.mine === false) {
    return (
      <div>
        <p className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-(--foreground)">
          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-(--accent) text-[10px] font-semibold text-(--muted-foreground)">
            {(message.authorName ?? "?").slice(0, 1).toUpperCase()}
          </span>
          {message.authorName ?? "Someone"}
        </p>
        <div className="max-w-[86%] whitespace-pre-wrap rounded-(--radius-lg) rounded-tl-(--radius-sm) border border-(--border) bg-(--card) px-3.5 py-2.5 text-[14.5px] leading-[1.55] text-(--foreground)">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] whitespace-pre-wrap rounded-(--radius-lg) rounded-br-(--radius-sm) border border-(--border-strong) bg-(--accent) px-3.5 py-2.5 text-[14.5px] leading-[1.55] text-(--foreground) shadow-[inset_-3px_0_0_var(--primary)]">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "system") {
    return <p className="text-center text-[12px] text-(--muted-foreground)">{message.content}</p>;
  }

  return (
    <div>
      {agentName ? (
        <p className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-(--foreground)">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: agentColor ?? "var(--entity-agent)" }} />
          {agentName}
        </p>
      ) : null}
      <div className={cn(
        "prose-sentinel text-[14.5px] leading-[1.65] text-(--foreground)",
        streaming && "after:ml-0.5 after:inline-block after:h-4 after:w-[2px] after:translate-y-0.5 after:animate-pulse after:bg-(--primary) after:align-middle after:content-[''] motion-reduce:after:animate-none",
      )}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}
