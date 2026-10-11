"use client";

import { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { agentLabel, formatDuration, phoneApi, type PhoneCall } from "../api";
import { usePolling } from "../usePolling";
import { Transcript } from "./Transcript";

const LIVE_POLL_MS = 2_000;

/** A call in progress: who is speaking, how long, what has been said so far, and a hang-up control. */
export function ActiveCall({ call: initial, onChanged }: { call: PhoneCall; onChanged: () => void }) {
  const { data } = usePolling(() => phoneApi.call(initial.id), LIVE_POLL_MS);
  const call = data ?? initial;
  const [now, setNow] = useState(() => Date.now());
  const [hangingUp, setHangingUp] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const since = new Date(call.answeredAt ?? call.startedAt).getTime();
  const seconds = Math.max(0, Math.floor((now - since) / 1_000));
  const who = call.contactName ?? (call.direction === "outbound" ? call.toNumber : call.fromNumber);

  async function hangUp() {
    setHangingUp(true);
    try {
      await phoneApi.hangup(call.id);
      onChanged();
    } finally {
      setHangingUp(false);
    }
  }

  return (
    <section aria-label="Active call" className="rounded-lg border border-[--canvas-card-border] bg-[--card] p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <h2 className="truncate text-sm font-medium text-[--canvas-foreground]">{who}</h2>
            <Badge variant="outline">{call.direction}</Badge>
            <Badge variant="outline">{call.status}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-[--muted-foreground]">
            {agentLabel(call.agentId)} is handling this call · {call.status === "active" ? formatDuration(seconds) : "connecting…"}
            {call.toolCallCount > 0 ? ` · ${call.toolCallCount} tool call${call.toolCallCount === 1 ? "" : "s"}` : ""}
            {call.trust === "screened" ? " · screened caller (message only)" : ""}
          </p>
          {call.purpose ? <p className="mt-1 text-[12px] text-[--muted-foreground]">Purpose: {call.purpose}</p> : null}
        </div>
        <Button variant="destructive" size="sm" onClick={hangUp} disabled={hangingUp} aria-label="Hang up">
          <PhoneOff className="h-3.5 w-3.5" /> Hang up
        </Button>
      </header>
      <div className="mt-4">
        <Transcript turns={call.turns ?? []} agent={agentLabel(call.agentId)} other={who} live />
      </div>
    </section>
  );
}
