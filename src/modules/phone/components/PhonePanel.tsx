"use client";

import { useState } from "react";
import { PhoneIncoming } from "lucide-react";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { agentLabel, IN_PROGRESS, phoneApi } from "../api";
import { usePolling } from "../usePolling";
import { ActiveCall } from "./ActiveCall";
import { CallsTab } from "./CallsTab";
import { DialerTab } from "./DialerTab";
import { MessagesTab } from "./MessagesTab";

const TABS = [
  { id: "dialer", label: "Dialer" },
  { id: "calls", label: "Calls" },
  { id: "messages", label: "Messages" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const LIVE_POLL_MS = 3_000;
const IDLE_POLL_MS = 10_000;

export function PhonePanel() {
  const [tab, setTab] = useState<TabId>("dialer");
  const { data: calls, refresh: refreshCalls } = usePolling(phoneApi.calls, IDLE_POLL_MS);
  const live = calls?.find((c) => IN_PROGRESS.includes(c.status)) ?? null;
  // Poll faster while a call is live so status changes and incoming calls show up promptly.
  const { data: fastCalls } = usePolling(phoneApi.calls, LIVE_POLL_MS, Boolean(live));
  const current = fastCalls ?? calls;
  const activeCall = current?.find((c) => IN_PROGRESS.includes(c.status)) ?? null;

  const { data: status } = usePolling(phoneApi.status, 30_000);
  const { data: contacts } = usePolling(phoneApi.contacts, 60_000);
  const { data: threads, refresh: refreshThreads } = usePolling(phoneApi.threads, IDLE_POLL_MS);

  // Calls present at first load are history; an inbound call that appears afterwards is announced until dismissed.
  const [baseline, setBaseline] = useState<Set<string> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  if (baseline === null && current) setBaseline(new Set(current.map((c) => c.id)));
  const ringing = baseline
    ? current?.find((c) => c.direction === "inbound" && IN_PROGRESS.includes(c.status) && !baseline.has(c.id) && !dismissed.has(c.id))
    : undefined;
  const incoming = ringing ? { id: ringing.id, who: ringing.contactName ?? ringing.fromNumber, agent: agentLabel(ringing.agentId) } : null;

  return (
    <WorkspaceShell>
      <WorkspaceHeader title="Phone" description={status?.fromNumber ? `Line ${status.fromNumber} · calls and texts handled by your agents` : "Calls and texts handled by your agents"} showBack={false} />

      {incoming ? (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[--primary]/40 bg-[--primary]/10 px-4 py-2.5 text-[13px] text-[--canvas-foreground]">
          <span className="flex items-center gap-2"><PhoneIncoming className="h-4 w-4" aria-hidden /> Incoming call from {incoming.who} — {incoming.agent} is answering.</span>
          <button type="button" className="text-[12px] text-[--muted-foreground] hover:text-[--canvas-foreground]" onClick={() => setDismissed((prev) => new Set(prev).add(incoming.id))}>Dismiss</button>
        </div>
      ) : null}

      {activeCall ? (
        <div className="mb-6">
          <ActiveCall key={activeCall.id} call={activeCall} onChanged={() => void refreshCalls()} />
        </div>
      ) : null}

      <div role="tablist" aria-label="Phone" className="mb-4 flex gap-1 border-b border-[--canvas-card-border]">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring] ${tab === t.id ? "border-[--primary] text-[--canvas-foreground]" : "border-transparent text-[--muted-foreground] hover:text-[--canvas-foreground]"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "dialer" ? <DialerTab status={status ?? null} contacts={contacts ?? []} busy={Boolean(activeCall)} onPlaced={() => { void refreshCalls(); setTab("dialer"); }} /> : null}
        {tab === "calls" ? <CallsTab calls={current ?? []} /> : null}
        {tab === "messages" ? <MessagesTab threads={threads ?? []} onSent={() => void refreshThreads()} /> : null}
      </div>
    </WorkspaceShell>
  );
}
