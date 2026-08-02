"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, ChevronDown, Loader2, AlertTriangle, Check } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useKeyStore } from "@/store/useKeyStore";
import { AGENT_TEMPLATES } from "@/lib/constants";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  agentId?: string;
  content: string;
  isStreaming?: boolean;
  error?: boolean;
}

const SUGGESTIONS = [
  "What's in my knowledge graph right now?",
  "Summarize the most recent decisions",
  "Help me plan today's work",
];

async function readSSEStream(
  response: Response,
  onToken: (text: string) => void
): Promise<{ error?: string }> {
  if (!response.body) return { error: "No response body" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]" || raw === "") continue;
        try {
          const parsed = JSON.parse(raw) as { type: string; text?: string; error?: string };
          if (parsed.type === "text" && parsed.text) onToken(parsed.text);
          if (parsed.type === "error") return { error: parsed.error };
        } catch {
          /* ignore malformed */
        }
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Stream error" };
  } finally {
    reader.releaseLock();
  }
  return {};
}

interface HomeChatProps {
  onStreamingChange?: (streaming: boolean) => void;
  onStreamEnd?: () => void;
}

export function HomeChat({ onStreamingChange, onStreamEnd }: HomeChatProps) {
  const { anthropicKey, openaiKey, openrouterKey } = useKeyStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [agentId, setAgentId] = useState(AGENT_TEMPLATES[0]?.id ?? "hermes-lisa");
  const [pickerOpen, setPickerOpen] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agent = AGENT_TEMPLATES.find((a) => a.id === agentId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || sending) return;
      setInput("");
      setSending(true);
      onStreamingChange?.(true);

      const agentMsgId = `agent-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content },
        { id: agentMsgId, role: "agent", agentId, content: "", isStreaming: true },
      ]);

      const history = messages.slice(-20).map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
      history.push({ role: "user", content });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(anthropicKey && { "x-anthropic-key": anthropicKey }),
            ...(openaiKey && { "x-openai-key": openaiKey }),
            ...(openrouterKey && { "x-openrouter-key": openrouterKey }),
          },
          body: JSON.stringify({ messages: history, agentId, userContent: content }),
        });

        let full = "";
        const { error } = await readSSEStream(response, (token) => {
          full += token;
          setMessages((prev) =>
            prev.map((m) => (m.id === agentMsgId ? { ...m, content: full } : m))
          );
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? {
                  ...m,
                  content: error ? `Something went wrong: ${error}` : full,
                  isStreaming: false,
                  error: !!error,
                }
              : m
          )
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? {
                  ...m,
                  content: `Something went wrong: ${
                    err instanceof Error ? err.message : "unknown error"
                  }`,
                  isStreaming: false,
                  error: true,
                }
              : m
          )
        );
      } finally {
        setSending(false);
        onStreamingChange?.(false);
        onStreamEnd?.();
        inputRef.current?.focus();
      }
    },
    [input, sending, agentId, messages, anthropicKey, openaiKey, openrouterKey, onStreamingChange, onStreamEnd]
  );

  return (
    <div className="flex h-full min-w-0 flex-col" onClick={() => setPickerOpen(false)}>
      {/* Pane header: agent picker */}
      <div className="flex shrink-0 items-center justify-between px-6 py-3">
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 rounded-full border border-[--border] bg-[--card] py-1.5 pl-2 pr-3 text-xs transition-colors hover:border-[--primary]/40"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[--primary]/10 text-[11px]">
              {agent?.avatar ?? "🤖"}
            </span>
            <span className="font-medium text-[--foreground]">{agent?.name ?? "Agent"}</span>
            <ChevronDown className="h-3 w-3 text-[--muted-foreground]" />
          </button>

          {pickerOpen && (
            <div className="animate-fade-in absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-[--border] bg-[--card] py-1 shadow-2xl">
              {AGENT_TEMPLATES.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setAgentId(a.id);
                    setPickerOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                    agentId === a.id ? "bg-[--primary]/10" : "hover:bg-[--accent]"
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[--primary]/10 text-sm">
                    {a.avatar}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[--foreground]">
                      {a.name}
                    </span>
                    <span className="block truncate text-[10px] text-[--muted-foreground]">
                      {a.role}
                    </span>
                  </span>
                  {agentId === a.id && <Check className="h-3 w-3 shrink-0 text-[--primary]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <Link
          href="/chat"
          className="text-xs text-[--muted-foreground] transition-colors hover:text-[--foreground]"
        >
          Open full chat
        </Link>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[--muted-foreground]">
                Sentinel OS
              </p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[--foreground]">
                What are we working on?
              </h1>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[--muted-foreground]">
                Every conversation feeds the knowledge graph beside you.
              </p>
              <div className="mt-8 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border border-[--border] px-4 py-2 text-xs text-[--muted-foreground] transition-colors hover:border-[--primary]/40 hover:text-[--foreground]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 py-6">
              {messages.map((msg) => (
                <Message key={msg.id} msg={msg} />
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-[--border] bg-[--card] px-4 py-3 transition-all focus-within:border-[--primary]/50 focus-within:ring-2 focus-within:ring-[--primary]/10">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message ${agent?.name ?? "your agent"}…`}
              className="max-h-40 flex-1 resize-none bg-transparent text-sm leading-relaxed text-[--foreground] outline-none placeholder:text-[--muted-foreground]"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || sending}
              title="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[--primary] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-[--muted-foreground]">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

function Message({ msg }: { msg: ChatMessage }) {
  const agent = msg.agentId ? AGENT_TEMPLATES.find((a) => a.id === msg.agentId) : undefined;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md border border-[--primary]/20 bg-[--primary]/15 px-4 py-2.5 text-sm leading-relaxed text-[--foreground]">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[--primary]/10 text-[10px]">
          {agent?.avatar ?? "🤖"}
        </span>
        <span className="text-[11px] font-medium text-[--muted-foreground]">
          {agent?.name ?? "Agent"}
        </span>
      </div>
      <div
        className={cn(
          "pl-7 text-sm leading-relaxed",
          msg.error ? "text-red-400" : "text-[--foreground]"
        )}
      >
        {msg.error && <AlertTriangle className="-mt-0.5 mr-1.5 inline h-3.5 w-3.5" />}
        {msg.content ? (
          msg.error ? (
            msg.content
          ) : (
            <div className="prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          )
        ) : msg.isStreaming ? (
          <span className="flex items-center gap-2 text-[--muted-foreground]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </span>
        ) : null}
        {msg.isStreaming && msg.content && (
          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-[--primary]" />
        )}
      </div>
    </div>
  );
}
