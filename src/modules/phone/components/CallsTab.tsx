"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { agentLabel, formatDuration, phoneApi, type PhoneCall } from "../api";
import { usePolling } from "../usePolling";
import { Transcript } from "./Transcript";

function CallRow({ call, open, onToggle }: { call: PhoneCall; open: boolean; onToggle: () => void }) {
  const who = call.contactName ?? (call.direction === "outbound" ? call.toNumber : call.fromNumber);
  const Icon = call.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;
  const { data } = usePolling(() => phoneApi.call(call.id), 60_000, open);
  const detail = data ?? call;

  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[--accent]/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]">
        <Icon className="h-4 w-4 shrink-0 text-[--muted-foreground]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-[--canvas-foreground]">{who}</span>
          <span className="block truncate text-[11px] text-[--muted-foreground]">
            {agentLabel(call.agentId)} · {formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
            {call.durationSeconds != null ? ` · ${formatDuration(call.durationSeconds)}` : ""}
          </span>
        </span>
        {call.trust === "screened" ? <Badge variant="outline">screened</Badge> : null}
        <Badge variant="outline">{call.status.replace("_", " ")}</Badge>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[--canvas-card-border] bg-[--card]/50 px-4 py-3">
          {detail.purpose ? <p className="text-[12px] text-[--muted-foreground]">Purpose: {detail.purpose}</p> : null}
          {detail.summary ? (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-[--muted-foreground]">Summary</h3>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-[--canvas-foreground]">{detail.summary}</p>
            </div>
          ) : null}
          <div>
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[--muted-foreground]">Transcript</h3>
            <Transcript turns={detail.turns ?? []} agent={agentLabel(call.agentId)} other={who} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function CallsTab({ calls }: { calls: PhoneCall[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (calls.length === 0) return <p className="px-1 py-10 text-center text-[13px] text-[--muted-foreground]">No calls yet.</p>;
  return (
    <ul className="divide-y divide-[--canvas-card-border] overflow-hidden rounded-lg border border-[--canvas-card-border]">
      {calls.map((call) => (
        <CallRow key={call.id} call={call} open={openId === call.id} onToggle={() => setOpenId(openId === call.id ? null : call.id)} />
      ))}
    </ul>
  );
}
