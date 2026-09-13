"use client";

import { useState } from "react";
import { ChevronRight, File as FileIcon, Folder, Loader2, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { EmptyNote, ErrorNote, formatBytes, relativeTime, useResource } from "./primitives";

export function FilesTab({ workspaceId, homePath, canWrite }: { workspaceId: string; homePath: string; canWrite: boolean }) {
  const [path, setPath] = useState(homePath);
  const [openFile, setOpenFile] = useState<{ path: string; content: string; readOnly: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ path: string; line: number; text: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const listing = useResource(() => workspaceApi.listFiles(workspaceId, path), `${workspaceId}:${path}`);

  async function open(filePath: string) {
    setBusy(true);
    setError(null);
    try {
      const file = await workspaceApi.readFile(workspaceId, filePath);
      setOpenFile({ path: file.path, content: file.content, readOnly: file.encoding !== "utf8" });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!openFile) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.writeFile(workspaceId, openFile.path, openFile.content);
      await listing.refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string, recursive: boolean) {
    if (!window.confirm(`Delete ${target}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await workspaceApi.deleteFile(workspaceId, target, recursive);
      if (openFile?.path === target) setOpenFile(null);
      await listing.refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const segments = path.replace(homePath, "").split("/").filter(Boolean);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-md border border-[--border]">
        <div className="flex items-center gap-2 border-b border-[--border] px-3 py-2">
          <button className="text-xs text-[--muted-foreground] hover:text-[--foreground]" onClick={() => setPath(homePath)}>
            {homePath}
          </button>
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="inline-flex items-center gap-1 text-xs">
              <ChevronRight className="h-3 w-3 text-[--muted-foreground]" />
              <button
                className="hover:underline"
                onClick={() => setPath(`${homePath}/${segments.slice(0, index + 1).join("/")}`)}
              >
                {segment}
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void listing.refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 border-b border-[--border] px-3 py-2">
          <Input
            value={query}
            placeholder="Search file contents"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={async (event) => {
              if (event.key !== "Enter" || !query.trim()) return;
              setBusy(true);
              try {
                const response = await fetch(`/api/agent-workspaces/${workspaceId}/files/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`);
                const body = await response.json();
                setMatches(response.ok ? body.matches : []);
                if (!response.ok) setError(new Error(body.error));
              } finally {
                setBusy(false);
              }
            }}
          />
          <Search className="h-3.5 w-3.5 text-[--muted-foreground]" />
        </div>

        <div className="max-h-[26rem] overflow-auto">
          {listing.loading ? <EmptyNote>Loading…</EmptyNote> : null}
          <ErrorNote error={listing.error} className="m-3" />
          {matches ? (
            <div className="divide-y divide-[--border]">
              <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[--muted-foreground]">
                <span>{matches.length} matches</span>
                <button className="hover:underline" onClick={() => setMatches(null)}>clear</button>
              </div>
              {matches.map((match, index) => (
                <button key={`${match.path}-${index}`} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[--accent]" onClick={() => void open(match.path)}>
                  <div className="truncate font-medium">{match.path.replace(`${homePath}/`, "")}:{match.line}</div>
                  <div className="truncate text-[--muted-foreground]">{match.text}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-[--border]">
              {listing.data?.entries.length === 0 ? <EmptyNote>This directory is empty.</EmptyNote> : null}
              {listing.data?.entries.map((entry) => (
                <div key={entry.path} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[--accent]">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => (entry.type === "directory" ? setPath(entry.path) : void open(entry.path))}
                  >
                    {entry.type === "directory" ? <Folder className="h-3.5 w-3.5 text-[--muted-foreground]" /> : <FileIcon className="h-3.5 w-3.5 text-[--muted-foreground]" />}
                    <span className="truncate">{entry.name}</span>
                  </button>
                  <span className="tabular-nums text-[--muted-foreground]">{entry.type === "directory" ? "" : formatBytes(entry.sizeBytes)}</span>
                  <span className="w-16 shrink-0 text-right text-[10px] text-[--muted-foreground]">{relativeTime(entry.modifiedAt)}</span>
                  {canWrite ? (
                    <button className="text-[--muted-foreground] hover:text-[--destructive]" onClick={() => void remove(entry.path, entry.type === "directory")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 rounded-md border border-[--border]">
        <div className="flex items-center gap-2 border-b border-[--border] px-3 py-2">
          <span className="truncate text-xs">{openFile?.path ?? "No file open"}</span>
          {openFile && canWrite && !openFile.readOnly ? (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </Button>
          ) : null}
        </div>
        <ErrorNote error={error} className="m-3" />
        {openFile ? (
          openFile.readOnly ? (
            <EmptyNote>This file is binary. Publish it as an artifact to download it.</EmptyNote>
          ) : (
            <textarea
              className="h-[26rem] w-full resize-none bg-transparent p-3 font-mono text-xs outline-none"
              value={openFile.content}
              spellCheck={false}
              readOnly={!canWrite}
              onChange={(event) => setOpenFile({ ...openFile, content: event.target.value })}
            />
          )
        ) : (
          <EmptyNote>Select a file to view or edit it.</EmptyNote>
        )}
      </div>
    </div>
  );
}
