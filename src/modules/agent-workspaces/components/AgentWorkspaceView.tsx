"use client";

import { useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { workspaceApi, type WorkspaceDetail } from "../api";
import { ErrorNote, useResource } from "./primitives";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { FilesTab } from "./FilesTab";
import { TerminalTab } from "./TerminalTab";
import { ProcessesTab } from "./ProcessesTab";
import { GitTab } from "./GitTab";
import { SnapshotsTab } from "./SnapshotsTab";
import { ArtifactsTab } from "./ArtifactsTab";
import { AccessTab } from "./AccessTab";
import { ActivityTab } from "./ActivityTab";
import { AdminTab } from "./AdminTab";
import { BrowserTab } from "./BrowserTab";

const TABS = ["files", "terminal", "browser", "processes", "git", "snapshots", "artifacts", "access", "activity", "admin"] as const;

export function AgentWorkspaceView({ workspaceId }: { workspaceId: string }) {
  const resource = useResource<WorkspaceDetail>(() => workspaceApi.detail(workspaceId), workspaceId);
  const { data: detail, error, loading, refresh } = resource;
  const load = useCallback(() => { void refresh(); }, [refresh]);

  if (loading && !detail) {
    return <div className="flex items-center gap-2 p-6 text-sm text-[--muted-foreground]"><Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…</div>;
  }
  if (!detail) return <div className="p-6"><ErrorNote error={error} /></div>;

  // A stopped runtime is a normal state, not an error: the data is still there.
  const running = detail.state === "RUNNING";
  const mutable = detail.state !== "ARCHIVED" && !detail.workspace.locked;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <ErrorNote error={error} />
      <WorkspaceHeader detail={detail} onChanged={load} />

      {!running ? (
        <div className="rounded-md border border-[--border] bg-[--muted]/30 px-3 py-2 text-xs text-[--muted-foreground]">
          The runtime is {detail.state.toLowerCase()}. Files, snapshots and artifacts are retained — start the runtime to browse or execute.
        </div>
      ) : null}

      <Tabs defaultValue="files">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="capitalize">{tab}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="files" className="pt-4">
          {running
            ? <FilesTab workspaceId={workspaceId} homePath={detail.workspace.homePath} canWrite={mutable} />
            : <StoppedNote />}
        </TabsContent>
        <TabsContent value="terminal" className="pt-4">
          <TerminalTab workspaceId={workspaceId} homePath={detail.workspace.homePath} canExecute={running && mutable} />
        </TabsContent>
        <TabsContent value="browser" className="pt-4">
          <BrowserTab workspaceId={workspaceId} browserRuntime={detail.browserRuntime} canExecute={running && mutable} />
        </TabsContent>
        <TabsContent value="processes" className="pt-4">
          <ProcessesTab workspaceId={workspaceId} canExecute={running && mutable} />
        </TabsContent>
        <TabsContent value="git" className="pt-4">
          {running ? <GitTab workspaceId={workspaceId} canExecute={mutable} /> : <StoppedNote />}
        </TabsContent>
        <TabsContent value="snapshots" className="pt-4">
          <SnapshotsTab workspaceId={workspaceId} canSnapshot={mutable} canRestore={mutable} onChanged={load} />
        </TabsContent>
        <TabsContent value="artifacts" className="pt-4">
          <ArtifactsTab workspaceId={workspaceId} canWrite={running && mutable} />
        </TabsContent>
        <TabsContent value="access" className="pt-4">
          <AccessTab detail={detail} canManage onChanged={load} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="admin" className="pt-4">
          <AdminTab detail={detail} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StoppedNote() {
  return (
    <div className="rounded-md border border-[--border] px-3 py-6 text-center text-xs text-[--muted-foreground]">
      Start the runtime to use this view. Workspace data is unaffected while the runtime is down.
    </div>
  );
}
