"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { EmptyNote, ErrorNote, relativeTime, StateBadge, useResource } from "./primitives";

/** Operational index of every agent computer the caller can see. */
export function WorkspaceListView({ agentId, tenantWorkspaces }: {
  agentId?: string;
  tenantWorkspaces: { id: string; name: string }[];
}) {
  const workspaces = useResource(() => workspaceApi.list(agentId ? { agentId } : {}), agentId ?? "all");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newAgentId, setNewAgentId] = useState(agentId ?? "");
  const [tenantWorkspaceId, setTenantWorkspaceId] = useState(tenantWorkspaces[0]?.id ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.create({ name, agentId: newAgentId, tenantWorkspaceId });
      setName("");
      setCreating(false);
      await workspaces.refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Agent Workspaces</h1>
          <p className="text-xs text-[--muted-foreground]">
            Persistent, isolated computers. Stopping a runtime never deletes its data.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((value) => !value)} disabled={!tenantWorkspaces.length}>
          <Plus className="h-3.5 w-3.5" /> New workspace
        </Button>
      </div>

      {creating ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] p-3">
          <Input className="w-56" placeholder="workspace name" value={name} onChange={(event) => setName(event.target.value)} />
          <Input className="w-56" placeholder="agent id" value={newAgentId} onChange={(event) => setNewAgentId(event.target.value)} />
          <select className="h-9 rounded-md border border-[--border] bg-transparent px-2 text-sm" value={tenantWorkspaceId} onChange={(event) => setTenantWorkspaceId(event.target.value)}>
            {tenantWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <Button size="sm" disabled={busy || !name.trim() || !newAgentId.trim() || !tenantWorkspaceId} onClick={() => void create()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Create
          </Button>
        </div>
      ) : null}

      <ErrorNote error={error} />
      <ErrorNote error={workspaces.error} />

      <div className="rounded-md border border-[--border]">
        {workspaces.loading ? <EmptyNote>Loading…</EmptyNote> : null}
        {workspaces.data?.workspaces.length === 0 ? <EmptyNote>No agent workspaces yet.</EmptyNote> : null}
        {workspaces.data?.workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={`/agent-workspaces/${workspace.id}`}
            className="flex flex-wrap items-center gap-3 border-b border-[--border] px-3 py-2.5 text-xs last:border-b-0 hover:bg-[--accent]"
          >
            <span className="w-48 truncate font-medium">{workspace.name}</span>
            <span className="w-40 truncate font-mono text-[--muted-foreground]">{workspace.agentId}</span>
            <StateBadge state={workspace.state} />
            <span className="min-w-0 flex-1 truncate text-[--muted-foreground]">
              {workspace.runtime?.containerName ?? workspace.volumeName ?? "not provisioned"}
            </span>
            <span className="text-[--muted-foreground]">{workspace.runtimeType}</span>
            <span className="w-28 text-right text-[--muted-foreground]">active {relativeTime(workspace.lastActiveAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
