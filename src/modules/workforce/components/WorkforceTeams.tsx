"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";

type Team = WorkforceSnapshot["teams"][number];
const blank = { name: "", description: "", memberAgentIds: [] as string[] };

export function WorkforceTeams({ data, onSaved }: { data: WorkforceSnapshot; onSaved: () => void }) {
  const [form, setForm] = useState<typeof blank | null>(null);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function open(team?: Team) {
    setId(team?.id ?? "");
    setForm(team ? { ...team, description: team.description ?? "" } : blank);
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workforce/teams", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.workspace.id, id: id || undefined, name: form.name,
          description: form.description, memberAgentIds: form.memberAgentIds,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save team.");
      setForm(null);
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save team.");
    } finally {
      setBusy(false);
    }
  }

  return <Card className="lg:col-span-2">
    <CardHeader><CardTitle>Workspace teams</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {!data.teams.length && <p className="text-sm text-(--muted-foreground)">No teams in this workspace.</p>}
      <ul className="space-y-2 text-sm">
        {data.teams.map((team) => <li key={team.id} className="flex flex-wrap items-center justify-between gap-1">
          <div><p><strong>{team.name}</strong> · {team.memberAgentIds.length} agent assignments</p>
            {team.description && <p className="text-(--muted-foreground)">{team.description}</p>}</div>
          {data.access.canUpdateTeams && <Button variant="ghost" size="sm" disabled={busy} onClick={() => open(team)}>Edit {team.name}</Button>}
        </li>)}
      </ul>
      {data.access.canCreateTeams && !form && <Button variant="outline" size="sm" onClick={() => open()}>New team</Button>}
      {form && <form onSubmit={save} className="space-y-2 border-t border-(--border) pt-3">
        <fieldset disabled={busy} className="space-y-2">
          <legend className="text-sm font-medium">{id ? "Edit team" : "Create team"}</legend>
          <label className="grid gap-1 text-sm">Team name
            <Input maxLength={120} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm">Description
            <Input maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Assigned agents</legend>
            {data.agents.map((agent) => <label key={agent.id} className="flex items-center gap-2">
              <input type="checkbox" checked={form.memberAgentIds.includes(agent.id)}
                onChange={(event) => setForm({
                  ...form, memberAgentIds: event.target.checked ? [...form.memberAgentIds, agent.id] : form.memberAgentIds.filter((entry) => entry !== agent.id),
                })} />
              {agent.name} · {agent.role}
            </label>)}
            {form.memberAgentIds.filter((agentId) => !data.agents.some((agent) => agent.id === agentId)).map((agentId) => <label key={agentId} className="flex items-center gap-2">
              <input type="checkbox" checked onChange={() => setForm({ ...form, memberAgentIds: form.memberAgentIds.filter((entry) => entry !== agentId) })} />
              Unavailable agent assignment
            </label>)}
            {!data.agents.length && !form.memberAgentIds.length && <p className="text-(--muted-foreground)">No agents are available in this workspace.</p>}
          </fieldset>
          <div className="flex gap-2">
            <Button size="sm">{busy ? "Saving…" : "Save team"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel team editing</Button>
          </div>
        </fieldset>
      </form>}
      {error && <p role="alert" className="text-sm text-(--destructive)">{error}</p>}
    </CardContent>
  </Card>;
}
