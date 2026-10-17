"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AGENTS, agentLabel, phoneApi, type PhoneMessage } from "../api";
import { usePolling } from "../usePolling";

function Thread({ counterparty, onSent }: { counterparty: string; onSent: () => void }) {
  const { data: messages, refresh } = usePolling(() => phoneApi.thread(counterparty), 8_000);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState<string>(AGENTS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await phoneApi.sendMessage({ agent, target: counterparty, text: text.trim() });
      setText("");
      await refresh();
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="flex-1 space-y-2 overflow-y-auto p-4" aria-label={`Messages with ${counterparty}`}>
        {(messages ?? []).map((m) => (
          <li key={m.id} className={m.direction === "outbound" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] ${m.direction === "outbound" ? "bg-[--primary]/15 text-[--canvas-foreground]" : "bg-[--muted] text-[--canvas-foreground]"}`}>
              {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
              {m.mediaUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-[12px] text-[--primary] underline">Attachment</a>
              ))}
              <p className="mt-1 text-[10px] text-[--muted-foreground]">
                {m.direction === "outbound" ? `${agentLabel(m.agentId)} · ${m.status}` : m.trust === "screened" ? "unverified sender" : "received"} · {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-[--canvas-card-border] p-3">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Send as"
          className="h-9 rounded-md border border-[--border] bg-transparent px-2 text-sm text-[--canvas-foreground]">
          {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" maxLength={1500} aria-label="Message text" />
        <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
      {error ? <p role="alert" className="px-4 pb-3 text-[12px] text-[--destructive]">{error}</p> : null}
    </div>
  );
}

export function MessagesTab({ threads, onSent }: { threads: PhoneMessage[]; onSent: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? threads[0]?.counterparty ?? null;

  if (threads.length === 0) return <p className="px-1 py-10 text-center text-[13px] text-[--muted-foreground]">No messages yet.</p>;
  return (
    <div className="grid h-[28rem] grid-cols-1 overflow-hidden rounded-lg border border-[--canvas-card-border] md:grid-cols-[16rem_1fr]">
      <ul className="max-h-40 divide-y divide-[--canvas-card-border] overflow-y-auto border-b border-[--canvas-card-border] md:max-h-none md:border-b-0 md:border-r">
        {threads.map((t) => (
          <li key={t.counterparty}>
            <button type="button" onClick={() => setSelected(t.counterparty)} aria-current={active === t.counterparty}
              className={`w-full px-4 py-3 text-left hover:bg-[--accent]/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring] ${active === t.counterparty ? "bg-[--accent]/40" : ""}`}>
              <span className="block truncate text-[13px] text-[--canvas-foreground]">{t.counterparty}</span>
              <span className="block truncate text-[11px] text-[--muted-foreground]">{t.text || "Attachment"}</span>
            </button>
          </li>
        ))}
      </ul>
      {active ? <Thread key={active} counterparty={active} onSent={onSent} /> : null}
    </div>
  );
}
