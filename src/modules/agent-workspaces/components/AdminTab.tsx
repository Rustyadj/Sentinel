"use client";

import { useState } from "react";
import { AlertTriangle, Lock, Archive, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi, type WorkspaceDetail } from "../api";
import { ErrorNote } from "./primitives";

/**
 * Admin surface. Runtime destruction and data deletion are deliberately
 * distinct actions with distinct confirmations — they are never one button.
 */
export function AdminTab({ detail, onChanged }: { detail: WorkspaceDetail; onChanged: () => void }) {
  const { workspace, limits } = detail;
  const [form, setForm] = useState(limits);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function guard(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const numberField = (label: string, key: keyof typeof form, hint: string) => (
    <label className="block text-xs">
      <span className="text-[--muted-foreground]">{label}</span>
      <Input
        type="number"
        value={String(form[key])}
        onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })}
      />
      <span className="text-[10px] text-[--muted-foreground]">{hint}</span>
    </label>
  );

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />

      <div className="rounded-md border border-[--border] p-3">
        <div className="mb-3 text-xs font-medium">Resource policy</div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {numberField("CPU", "cpus", "cores")}
          {numberField("Memory", "memoryMb", "MB")}
          {numberField("Disk", "diskGb", "GB (advisory)")}
          {numberField("Max processes", "pidsLimit", "pids")}
          {numberField("Command timeout", "commandTimeoutMs", "ms")}
          {numberField("Idle timeout", "idleTimeoutMs", "ms before auto-pause")}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-[--border] bg-transparent px-2 text-sm"
            value={form.network}
            onChange={(event) => setForm({ ...form, network: event.target.value as "none" | "bridge" })}
          >
            <option value="bridge">network: bridge (egress allowed)</option>
            <option value="none">network: none (no egress)</option>
          </select>
          <Button size="sm" disabled={busy} onClick={() => void guard(() => workspaceApi.update(workspace.id, { resourceLimits: form }))}>
            Save policy
          </Button>
          <span className="text-[11px] text-[--muted-foreground]">Applied on the next runtime restart.</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-md border border-[--border] p-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void guard(() => workspaceApi.update(workspace.id, { locked: !workspace.locked }))}>
          {workspace.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {workspace.locked ? "Unlock workspace" : "Lock workspace"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void guard(() => workspaceApi.runtimeAction(workspace.id, workspace.status === "ARCHIVED" ? "unarchive" : "archive"))}>
          <Archive className="h-3.5 w-3.5" />
          {workspace.status === "ARCHIVED" ? "Unarchive" : "Archive (release compute, keep data)"}
        </Button>
      </div>

      <div className="space-y-3 rounded-md border border-[--destructive]/40 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[--destructive]">
          <AlertTriangle className="h-3.5 w-3.5" /> Destructive actions
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => {
            if (!window.confirm("Destroy the runtime container? Files, snapshots and artifacts are kept.")) return;
            void guard(() => workspaceApi.destroyRuntime(workspace.id));
          }}>
            Delete runtime (data kept)
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-64"
            placeholder={`type "${workspace.name}" to confirm`}
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          <Button size="sm" variant="destructive" disabled={busy || confirmName !== workspace.name} onClick={() => {
            if (!window.confirm("Permanently delete this workspace's data volume and all snapshots? This cannot be undone.")) return;
            void guard(() => workspaceApi.deleteData(workspace.id, confirmName));
          }}>
            Delete workspace data permanently
          </Button>
        </div>
        <p className="text-[11px] text-[--muted-foreground]">
          Runtime destruction and data deletion are separate operations with separate permissions.
        </p>
      </div>
    </div>
  );
}
