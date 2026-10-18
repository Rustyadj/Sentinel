"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

/**
 * A message, not a dashboard card. Assistant turns carry no chrome — the
 * agent's name in its own colour, then the prose. User turns sit on a raised
 * surface with a brass edge, so whose turn is whose reads at a glance.
 */
export function ConversationMessage({ message, agentName, agentColor, streaming }: {
  message: Message;
  agentName?: string;
  agentColor?: string;
  streaming?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-(--border-strong) bg-(--accent) px-3.5 py-2.5 text-[14.5px] leading-[1.55] text-(--foreground) shadow-[inset_-2px_0_0_var(--primary)]">
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
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: agentColor ?? "var(--entity-agent)" }} />
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
