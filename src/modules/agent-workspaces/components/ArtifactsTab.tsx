"use client";

import { useState } from "react";
import { Download, Package, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { EmptyNote, ErrorNote, formatBytes, relativeTime, useResource } from "./primitives";

export function ArtifactsTab({ workspaceId, canWrite }: { workspaceId: string; canWrite: boolean }) {
  const artifacts = useResource(() => workspaceApi.artifacts(workspaceId), workspaceId);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function guard(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await artifacts.refresh();
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] p-3">
          <Input className="min-w-[18rem] flex-1 font-mono" placeholder="path to file inside the workspace" value={path} onChange={(event) => setPath(event.target.value)} />
          <Input className="w-52" placeholder="display name (optional)" value={name} onChange={(event) => setName(event.target.value)} />
          <Button size="sm" disabled={!path.trim()} onClick={() => void guard(async () => {
            await workspaceApi.createArtifact(workspaceId, path, name || undefined);
            setPath(""); setName("");
          })}>
            <Package className="h-3.5 w-3.5" /> Publish artifact
          </Button>
        </div>
      ) : null}

      <ErrorNote error={error} />
      <ErrorNote error={artifacts.error} />

      <div className="rounded-md border border-[--border]">
        {artifacts.data?.artifacts.length ? artifacts.data.artifacts.map((artifact) => (
          <div key={artifact.id} className="flex flex-wrap items-center gap-3 border-b border-[--border] px-3 py-2 text-xs last:border-b-0">
            <span className="w-52 truncate font-medium">{artifact.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[--muted-foreground]">{artifact.path}</span>
            <span>{artifact.contentType}</span>
            <span className="tabular-nums">{formatBytes(artifact.sizeBytes)}</span>
            <span className="text-[--muted-foreground]">{relativeTime(artifact.createdAt)}</span>
            <a className="inline-flex items-center gap-1 hover:underline" href={workspaceApi.artifactDownloadUrl(workspaceId, artifact.id)}>
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            {canWrite ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => void guard(() => workspaceApi.pinArtifact(workspaceId, artifact.id, !artifact.pinned))}>
                  {artifact.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  if (!window.confirm(`Remove "${artifact.name}" from the artifact list? The workspace file is kept.`)) return;
                  void guard(() => workspaceApi.deleteArtifact(workspaceId, artifact.id));
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : null}
          </div>
        )) : <EmptyNote>No artifacts published from this workspace.</EmptyNote>}
      </div>
    </div>
  );
}
