"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AGENTS, phoneApi, type PhoneContact, type PhoneStatus } from "../api";

const FIELD = "w-full rounded-md border border-[--border] bg-transparent px-3 py-2 text-sm text-[--canvas-foreground] placeholder:text-[--muted-foreground] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]";

/** Starts a call immediately. There is deliberately no confirmation step: asking for the call is the authorization. */
export function DialerTab({ status, contacts, busy, onPlaced }: {
  status: PhoneStatus | null;
  contacts: PhoneContact[];
  busy: boolean;
  onPlaced: () => void;
}) {
  const [agent, setAgent] = useState<string>(AGENTS[0].id);
  const [target, setTarget] = useState("");
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(status?.configured && status.calling);
  const canSubmit = ready && !busy && !submitting && target.trim() !== "" && purpose.trim() !== "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await phoneApi.placeCall({ agent, target: target.trim(), purpose: purpose.trim() });
      setTarget("");
      setPurpose("");
      onPlaced();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The call could not be placed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      {!ready ? (
        <p role="status" className="rounded-md border border-[--canvas-card-border] px-3 py-2 text-[12px] text-[--muted-foreground]">
          {status?.reason ?? "Voice calling is not configured on this deployment."}
        </p>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[--muted-foreground]">Agent</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Agent">
          {AGENTS.map((a) => (
            <Button key={a.id} type="button" role="radio" aria-checked={agent === a.id} size="sm"
              variant={agent === a.id ? "default" : "outline"} onClick={() => setAgent(a.id)}>
              {a.label}
            </Button>
          ))}
        </div>
      </label>

      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[--muted-foreground]">Number or contact</span>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="+15551234567 or a saved name" list="phone-contacts" autoComplete="off" />
        <datalist id="phone-contacts">
          {contacts.filter((c) => c.callable).map((c) => <option key={c.id} value={c.name}>{c.number}</option>)}
        </datalist>
      </label>

      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[--muted-foreground]">What should the call accomplish?</span>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} maxLength={1000} className={FIELD}
          placeholder="Ask whether they have 3,000 sq ft of membrane in stock and get pricing." />
      </label>

      {error ? <p role="alert" className="text-[12px] text-[--destructive]">{error}</p> : null}
      {busy ? <p className="text-[12px] text-[--muted-foreground]">A call is already in progress.</p> : null}

      <Button type="submit" disabled={!canSubmit}><Phone className="h-3.5 w-3.5" /> {submitting ? "Calling…" : "Call now"}</Button>
    </form>
  );
}
