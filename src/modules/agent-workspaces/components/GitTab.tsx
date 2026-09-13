"use client";

import { useState } from "react";
import { GitBranch, GitCommit, GitPullRequest, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { ErrorNote } from "./primitives";

export function GitTab({ workspaceId, canExecute }: { workspaceId: string; canExecute: boolean }) {
  const [path, setPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [directory, setDirectory] = useState("repos/new-repo");
  const [branch, setBranch] = useState("");
  const [message, setMessage] = useState("");
  const [output, setOutput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(operation: string, body: Record<string, unknown> = {}) {
    setPending(operation);
    setError(null);
    try {
      const { result } = await workspaceApi.git(workspaceId, { operation, path: path || undefined, ...body });
      setOutput(`$ git ${operation}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(null);
    }
  }

  const busy = Boolean(pending);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-72" placeholder="repository path (blank = workspace root)" value={path} onChange={(event) => setPath(event.target.value)} />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("status")}>Status</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("diff")}>Diff</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("log")}>Log</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("branch")}>Branches</Button>
        <Button size="sm" variant="outline" disabled={busy || !canExecute} onClick={() => void run("fetch")}>Fetch</Button>
        <Button size="sm" variant="outline" disabled={busy || !canExecute} onClick={() => void run("pull")}>Pull</Button>
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-[--muted-foreground]" /> : null}
      </div>

      {canExecute ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 rounded-md border border-[--border] p-3">
            <div className="flex items-center gap-2 text-xs font-medium"><GitPullRequest className="h-3.5 w-3.5" /> Clone repository</div>
            <Input placeholder="https://github.com/org/repo.git" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} />
            <Input placeholder="target directory" value={directory} onChange={(event) => setDirectory(event.target.value)} />
            <Button size="sm" disabled={busy || !remoteUrl.trim()} onClick={() => void run("clone", { remoteUrl, directory })}>Clone</Button>
            <p className="text-[11px] text-[--muted-foreground]">Credentials are injected by Sentinel at execution time and never stored in the workspace.</p>
          </div>

          <div className="space-y-2 rounded-md border border-[--border] p-3">
            <div className="flex items-center gap-2 text-xs font-medium"><GitBranch className="h-3.5 w-3.5" /> Branch</div>
            <Input placeholder="branch name" value={branch} onChange={(event) => setBranch(event.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy || !branch.trim()} onClick={() => void run("checkout", { branch })}>Checkout</Button>
              <Button size="sm" variant="outline" disabled={busy || !branch.trim()} onClick={() => void run("branch", { branch })}>Create</Button>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-[--border] p-3">
            <div className="flex items-center gap-2 text-xs font-medium"><GitCommit className="h-3.5 w-3.5" /> Commit</div>
            <Input placeholder="commit message" value={message} onChange={(event) => setMessage(event.target.value)} />
            <Button size="sm" disabled={busy || !message.trim()} onClick={() => void run("commit", { message, addAll: true })}>Stage all &amp; commit</Button>
          </div>
        </div>
      ) : null}

      <ErrorNote error={error} />
      <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[--border] bg-black/30 p-3 font-mono text-xs">
        {output || "Run a git operation to see its output."}
      </pre>
    </div>
  );
}
