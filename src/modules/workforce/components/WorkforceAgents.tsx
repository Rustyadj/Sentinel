"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";

type Identity = { name: string; role: string; description: string; systemPrompt: string | null };

export function WorkforceAgents({ data, onChange }: { data: WorkforceSnapshot; onChange: () => void }) {
  const [selected, setSelected] = useState("");
  return <Card>
    <CardHeader><CardTitle>Agent profiles</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {!data.access.canReadAgents && <p className="text-sm">Agent profiles require runtime view access.</p>}
      {data.access.canReadAgents && !data.agents.length && <p className="text-sm">No agent records in this workspace.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {data.agents.map((agent) => {
          const runtimes = data.runtimes.filter((runtime) => runtime.agentId === agent.id);
          return <article key={agent.id} className="rounded-md border border-(--border) p-3 text-sm">
            <h3 className="font-semibold">{agent.name}</h3>
            <p>{agent.role} · {agent.status}</p>
            {agent.description && <p className="mt-1">{agent.description}</p>}
            <dl className="mt-2 space-y-1 text-xs">
              <div><dt className="inline font-medium">Configured model </dt><dd className="inline">{agent.model}</dd></div>
              <div><dt className="inline font-medium">Memory scope </dt><dd className="inline">{agent.memoryScope}</dd></div>
              <div><dt className="inline font-medium">Runtime </dt><dd className="inline">{runtimes.length ? runtimes.map((rt) => `${rt.kind} (${rt.executionVerified ? "verified" : "unverified"})`).join(", ") : "No workspace runtime binding"}</dd></div>
              {agent.skills.length > 0 && <div><dt className="inline font-medium">Skills </dt><dd className="inline">{agent.skills.join(", ")}</dd></div>}
            </dl>
            {data.access.plan && <Button className="mt-2" size="sm" variant="outline" onClick={() => setSelected((current) => current === agent.id ? "" : agent.id)}>
              {selected === agent.id ? "Close identity editor" : `Edit ${agent.name}’s identity`}
            </Button>}
            {selected === agent.id && <IdentityEditor key={agent.id} agentId={agent.id} onChange={onChange} />}
          </article>;
        })}
      </div>
      <Button asChild variant="outline" size="sm"><Link href="/agents">Runtime and model configuration</Link></Button>
    </CardContent>
  </Card>;
}

function IdentityEditor({ agentId, onChange }: { agentId: string; onChange: () => void }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/agents/${encodeURIComponent(agentId)}`;

  useEffect(() => {
    const abort = new AbortController();
    fetch(endpoint, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the agent identity.");
        const { name, role, description, systemPrompt } = await response.json();
        if (!abort.signal.aborted) setIdentity({ name, role, description, systemPrompt });
      }).catch((error: Error) => {
        if (!abort.signal.aborted) setStatus(error.message);
      });
    return () => abort.abort();
  }, [endpoint]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!identity) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...identity, name: identity.name.trim(), role: identity.role.trim() }),
      });
      if (!response.ok) throw new Error("Could not save the agent identity.");
      setStatus("Identity saved.");
      onChange();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the agent identity.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-3">
    {identity && <form onSubmit={save}>
      <fieldset disabled={busy} className="space-y-2">
        <label className="grid gap-1">Name<Input value={identity.name} maxLength={120} required onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></label>
        <label className="grid gap-1">Role<Input value={identity.role} maxLength={120} required onChange={(event) => setIdentity({ ...identity, role: event.target.value })} /></label>
        <label className="grid gap-1">Description<Input value={identity.description} maxLength={2000} onChange={(event) => setIdentity({ ...identity, description: event.target.value })} /></label>
        <label className="grid gap-1">Identity instructions
          <textarea className="min-h-24 rounded-md border border-(--border) bg-(--background) p-2" value={identity.systemPrompt ?? ""} maxLength={6000}
            onChange={(event) => setIdentity({ ...identity, systemPrompt: event.target.value })} />
        </label>
        <Button size="sm" disabled={!identity.name.trim() || !identity.role.trim()}>{busy ? "Saving…" : "Save identity"}</Button>
      </fieldset>
    </form>}
    <p role="status">{status || (!identity ? "Loading identity…" : "")}</p>
  </div>;
}
