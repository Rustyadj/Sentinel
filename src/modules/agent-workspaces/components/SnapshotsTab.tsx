"use client";

import { useState } from "react";
import { Camera, GitCompare, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { EmptyNote, ErrorNote, formatBytes, relativeTime, useResource } from "./primitives";

export function SnapshotsTab({ workspaceId, canSnapshot, canRestore, onChanged }: {
  workspaceId: string; canSnapshot: boolean; canRestore: boolean; onChanged: () => void;
}) {
  const snapshots = useResource(() => workspaceApi.snapshots(workspaceId), workspaceId);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function guard(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await snapshots.refresh();
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canSnapshot ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] p-3">
          <Input className="w-56" placeholder="snapshot name" value={name} onChange={(event) => setName(event.target.value)} />
          <Input className="min-w-[16rem] flex-1" placeholder="reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} />
          <Button size="sm" disabled={busy || !reason.trim()} onClick={() => void guard(() => workspaceApi.createSnapshot(workspaceId, name, reason))}>
            <Camera className="h-3.5 w-3.5" /> Create snapshot
          </Button>
        </div>
      ) : null}

      <ErrorNote error={error} />
      <ErrorNote error={snapshots.error} />

      <div className="rounded-md border border-[--border]">
        {snapshots.data?.snapshots.length ? snapshots.data.snapshots.map((snapshot) => (
          <div key={snapshot.id} className="flex flex-wrap items-center gap-3 border-b border-[--border] px-3 py-2 text-xs last:border-b-0">
            <input
              type="checkbox"
              checked={selected.includes(snapshot.id)}
              onChange={(event) => setSelected((current) => event.target.checked ? [...current, snapshot.id].slice(-2) : current.filter((id) => id !== snapshot.id))}
            />
            <span className="w-56 truncate font-medium">{snapshot.name}</span>
            <span className="min-w-0 flex-1 truncate text-[--muted-foreground]">{snapshot.reason}</span>
            <span>{snapshot.status}</span>
            <span className="tabular-nums">{formatBytes(snapshot.sizeBytes)}</span>
            <span className="text-[--muted-foreground]">{relativeTime(snapshot.createdAt)}</span>
            {canRestore ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || snapshot.status !== "ready"}
                onClick={() => {
                  if (!window.confirm(`Restore "${snapshot.name}"? Current workspace files are replaced and the runtime is stopped.`)) return;
                  void guard(() => workspaceApi.restoreSnapshot(workspaceId, snapshot.id));
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </Button>
            ) : null}
            {canSnapshot ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                if (!window.confirm(`Delete snapshot "${snapshot.name}"?`)) return;
                void guard(() => workspaceApi.deleteSnapshot(workspaceId, snapshot.id));
              }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )) : <EmptyNote>No snapshots yet. Take one before any risky operation.</EmptyNote>}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={selected.length !== 2}
          onClick={async () => setComparison(await workspaceApi.compareSnapshots(workspaceId, selected[0], selected[1]))}
        >
          <GitCompare className="h-3.5 w-3.5" /> Compare selected
        </Button>
        <span className="text-[11px] text-[--muted-foreground]">Select two snapshots to compare. Comparing never restores.</span>
      </div>

      {comparison ? (
        <pre className="max-h-72 overflow-auto rounded-md border border-[--border] bg-black/30 p-3 font-mono text-[11px]">
          {JSON.stringify(comparison, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
