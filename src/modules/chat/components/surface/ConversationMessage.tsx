"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

/**
 * A message, not a dashboard card. Assistant turns carry no chrome at all —
 * just the agent's name and the prose. User turns get one subtle bubble so the
 * conversation stays readable at a glance.
 */
export function ConversationMessage({ message, agentName, streaming }: {
  message: Message;
  agentName?: string;
  streaming?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[46rem] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[--muted] px-4 py-2.5 text-[15px] leading-[1.65] text-[--foreground]">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "system") {
    return <p className="text-center text-[12px] text-[--muted-foreground]">{message.content}</p>;
  }

  return (
    <div className="max-w-[52rem]">
      {agentName ? (
        <p className="mb-1 text-[12px] font-medium text-[--muted-foreground]">{agentName}</p>
      ) : null}
      <div className={cn(
        "prose-sentinel text-[15px] leading-[1.7] text-[--foreground]",
        streaming && "after:ml-0.5 after:inline-block after:h-4 after:w-[2px] after:translate-y-0.5 after:animate-pulse after:bg-[--primary] after:align-middle after:content-['']",
      )}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}
