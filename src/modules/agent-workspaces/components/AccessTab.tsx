"use client";

import { useState } from "react";
import { ShieldCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi, type WorkspaceDetail } from "../api";
import { EmptyNote, ErrorNote, relativeTime, useResource } from "./primitives";

/** Explicit sharing, ownership transfer and cloning. No implicit access anywhere. */
export function AccessTab({ detail, canManage, onChanged }: { detail: WorkspaceDetail; canManage: boolean; onChanged: () => void }) {
  const workspaceId = detail.workspace.id;
  const permissions = useResource(() => workspaceApi.permissions(workspaceId), workspaceId);
  const [granteeAgentId, setGranteeAgentId] = useState("");
  const [granteeUserId, setGranteeUserId] = useState("");
  const [level, setLevel] = useState("read");
  const [reason, setReason] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [cloneAgent, setCloneAgent] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function guard(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await permissions.refresh();
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[--border] p-3 text-xs">
        <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-3.5 w-3.5" /> Ownership</div>
        <p className="mt-1 text-[--muted-foreground]">
          Owned by agent <span className="font-mono">{detail.workspace.agentId}</span>, user <span className="font-mono">{detail.identity.ownerId}</span>.
          Every other agent needs an explicit grant below — there is no implicit cross-agent access.
        </p>
      </div>

      <ErrorNote error={error} />

      <div className="rounded-md border border-[--border]">
        <div className="border-b border-[--border] px-3 py-2 text-xs font-medium">Grants</div>
        {permissions.data?.permissions.length ? permissions.data.permissions.map((grant) => (
          <div key={grant.id} className="flex flex-wrap items-center gap-3 border-b border-[--border] px-3 py-2 text-xs last:border-b-0">
            <span className="w-64 truncate font-mono">{grant.granteeAgentId ? `agent:${grant.granteeAgentId}` : `user:${grant.granteeUserId}`}</span>
            <span className="w-16">{grant.level}</span>
            <span className="min-w-0 flex-1 truncate text-[--muted-foreground]">{grant.reason ?? "—"}</span>
            <span className={grant.revokedAt ? "text-[--muted-foreground]" : "text-emerald-400"}>{grant.revokedAt ? "revoked" : "active"}</span>
            <span className="text-[--muted-foreground]">{relativeTime(grant.createdAt)}</span>
            {canManage && !grant.revokedAt ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void guard(() => workspaceApi.revoke(workspaceId, grant.id))}>
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )) : <EmptyNote>No grants. Only the owning agent can use this workspace.</EmptyNote>}
      </div>

      {canManage ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 rounded-md border border-[--border] p-3">
            <div className="flex items-center gap-2 text-xs font-medium"><UserPlus className="h-3.5 w-3.5" /> Share</div>
            <Input placeholder="grantee agent id" value={granteeAgentId} onChange={(event) => { setGranteeAgentId(event.target.value); setGranteeUserId(""); }} />
            <Input placeholder="or grantee user id" value={granteeUserId} onChange={(event) => { setGranteeUserId(event.target.value); setGranteeAgentId(""); }} />
            <select className="h-9 w-full rounded-md border border-[--border] bg-transparent px-2 text-sm" value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="read">read</option>
              <option value="write">write</option>
              <option value="admin">admin</option>
            </select>
            <Input placeholder="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            <Button size="sm" disabled={busy || (!granteeAgentId && !granteeUserId)} onClick={() => void guard(async () => {
              await workspaceApi.grant(workspaceId, {
                granteeAgentId: granteeAgentId || null,
                granteeUserId: granteeUserId || null,
                level, reason,
              });
              setGranteeAgentId(""); setGranteeUserId(""); setReason("");
            })}>Grant access</Button>
          </div>

          <div className="space-y-2 rounded-md border border-[--border] p-3">
            <div className="text-xs font-medium">Transfer ownership</div>
            <Input placeholder="target agent id" value={transferTo} onChange={(event) => setTransferTo(event.target.value)} />
            <Input placeholder="reason" value={transferReason} onChange={(event) => setTransferReason(event.target.value)} />
            <Button size="sm" variant="outline" disabled={busy || !transferTo.trim() || !transferReason.trim()} onClick={() => {
              if (!window.confirm(`Transfer this workspace to ${transferTo}? The previous agent keeps read access.`)) return;
              void guard(() => workspaceApi.transfer(workspaceId, { toAgentId: transferTo, reason: transferReason, keepPreviousAgentAccess: "read" }));
            }}>Transfer</Button>
          </div>

          <div className="space-y-2 rounded-md border border-[--border] p-3">
            <div className="text-xs font-medium">Clone workspace</div>
            <Input placeholder="target agent id" value={cloneAgent} onChange={(event) => setCloneAgent(event.target.value)} />
            <Input placeholder="new workspace name" value={cloneName} onChange={(event) => setCloneName(event.target.value)} />
            <Button size="sm" variant="outline" disabled={busy || !cloneAgent.trim() || !cloneName.trim()} onClick={() => void guard(() => workspaceApi.clone(workspaceId, { targetAgentId: cloneAgent, name: cloneName }))}>
              Clone
            </Button>
            <p className="text-[11px] text-[--muted-foreground]">Creates an independent copy with its own volume. The source is untouched.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
