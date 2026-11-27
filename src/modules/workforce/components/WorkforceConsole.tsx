"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";
import { objectiveActionKey, type Surface, type SurfaceAction } from "@/lib/workforce/surface";
import { OrganizationDesigner } from "./OrganizationDesigner";
import { WorkforceMedia } from "./WorkforceMedia";
import { WorkforceAgents } from "./WorkforceAgents";
import { WorkforceConnections } from "./WorkforceConnections";
import { WorkforceGenesis } from "./WorkforceGenesis";
import { WorkforceSkills } from "./WorkforceSkills";
import { WorkforceSurface } from "./WorkforceSurface";

type WorkspaceChoice = { id: string; name: string };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percentage = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

export function WorkforceConsole({ workspaces }: { workspaces: WorkspaceChoice[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  return <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
    {workspaces.length ? <>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm font-medium">
        <label htmlFor="workforce-workspace">Workspace</label>
        <select id="workforce-workspace" className="max-w-full rounded-md border border-(--border) bg-(--background) p-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </div>
      <WorkspacePanel key={workspaceId} workspaceId={workspaceId} />
    </> : <p>You need access to a workspace to use Workforce.</p>}
  </div>;
}

function WorkspacePanel({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<WorkforceSnapshot | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState("overview");
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    const abort = new AbortController();
    let running = false;
    async function load() {
      if (running || abort.signal.aborted) return;
      running = true;
      try {
        const response = await fetch(`/api/workforce?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load workforce data.");
        if (abort.signal.aborted) return;
        setData(body);
        setError("");
      } catch (error) {
        if (!abort.signal.aborted) {
          setError(error instanceof Error ? error.message : "Could not load workforce data.");
          setData(null);
        }
      } finally {
        running = false;
      }
    }
    void load();
    const timer = active === "operations" ? window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000) : undefined;
    return () => {
      window.clearInterval(timer);
      abort.abort();
    };
  }, [workspaceId, revision, active]);

  if (!data) return error
    ? <div className="space-y-2"><p role="alert">{error}</p><Button variant="outline" onClick={refresh}>Retry</Button></div>
    : <p role="status">Loading workforce…</p>;

  return <Tabs value={active} onValueChange={setActive}>
    <div>
      <TabsList className="flex-wrap justify-start" aria-label="Workforce views">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="organization">Organization</TabsTrigger>
        <TabsTrigger value="genesis">Genesis</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="operations">Operations</TabsTrigger>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        {data.access.canExecute && <TabsTrigger value="media">Media</TabsTrigger>}
      </TabsList>
    </div>
    <TabsContent value="overview"><Overview data={data} onChange={refresh} /></TabsContent>
    <TabsContent value="organization"><OrganizationDesigner data={data} onSaved={refresh} /></TabsContent>
    <TabsContent value="genesis" forceMount className="data-[state=inactive]:hidden"><WorkforceGenesis workspace={data.workspace} canPlan={data.access.plan} providerAvailable={data.planningAvailable} /></TabsContent>
    <TabsContent value="agents"><WorkforceAgents data={data} onChange={refresh} /></TabsContent>
    <TabsContent value="operations"><Operations data={data} onChange={refresh} /></TabsContent>
    {data.access.canExecute && <TabsContent value="media"><WorkforceMedia workspaceId={workspaceId} available={data.mediaAvailable} /></TabsContent>}
    <TabsContent value="skills"><WorkforceSkills skills={data.skills} canEdit={data.access.canUpdateWorkspace} onChange={refresh} /></TabsContent>
  </Tabs>;
}

function Overview({ data, onChange }: { data: WorkforceSnapshot; onChange: () => void }) {
  const stats = data.analytics;
  const surface: Surface = {
    version: 1, title: "Workspace overview", components: [{
      id: "counts", type: "metrics",
      values: [
        { label: "Departments", value: data.workspace.organization ? String(data.departments.length) : "—" },
        { label: "Agents marked online", value: data.access.canReadAgents ? String(data.agents.filter((agent) => agent.status === "online").length) : "—" },
        { label: "Workspace teams", value: data.access.canReadTeams ? String(data.teams.length) : "—" },
        { label: "Verified runtime bindings", value: data.access.canReadAgents ? String(data.runtimes.filter((runtime) => runtime.executionVerified).length) : "—" },
      ],
    }],
  };
  if (stats) {
    surface.components.push({
      id: "summary", type: "text",
      text: "Objective steps updated in the last 30 days. Success rate counts completed and failed steps. Recorded cost sums reported objective step charges. Reporting coverage varies by executor.",
    }, {
      id: "results", type: "metrics", values: [
        { label: "Completed steps", value: String(stats.completed) },
        { label: "Failed steps", value: String(stats.failed) },
        { label: "Completed after retry", value: String(stats.completedAfterRetry) },
        { label: "Step success rate", value: stats.successRate === null ? "—" : percentage.format(stats.successRate) },
        { label: "Mean completed step", value: stats.averageDurationMs === null ? "—" : `${Math.round(stats.averageDurationMs / 1000)} s` },
        { label: "Recorded step cost", value: usd.format(stats.recordedCostCents / 100) },
        { label: "Estimated step cost", value: usd.format(stats.estimatedCostCents / 100) },
      ],
    });
  }
  if (data.runs.length) surface.components.push({
    id: "run-status", type: "barChart", caption: "Workspace-level execution runs created in the last 30 days",
    values: data.runs.map((run) => ({ label: statusText(run.status), value: run._count._all })).slice(0, 20),
  });
  return <div className="space-y-4">
    <WorkforceSurface surface={surface} />
    {data.access.canReadAgents && <WorkforceConnections data={data} onChange={onChange} />}
  </div>;
}

const statusText = (status: string) => status.toLowerCase().replaceAll("_", " ");
const retryable = new Set(["blocked", "failed", "advised", "cancelled"]);

function Operations({ data, onChange }: { data: WorkforceSnapshot; onChange: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<unknown>(null);

  if (!data.access.canReadTasks) return <p className="text-sm">Operations require permission to read workspace tasks.</p>;
  const allowed = new Map<string, string>();
  function actions(objective: WorkforceSnapshot["objectives"][number]) {
    if (!data.access.controlObjectives) return [];
    const list: SurfaceAction[] = [];
    function add(action: SurfaceAction["action"], label: string, stepKey?: string) {
      const item: SurfaceAction = { id: `action-${list.length}`, type: "action", action, label, objectiveId: objective.id, stepKey };
      allowed.set(objectiveActionKey(item), label);
      list.push(item);
    }
    if (["running", "waiting_approval"].includes(objective.status)) add("pause", "Pause");
    if (["paused", "blocked", "failed"].includes(objective.status)) add("resume", "Resume");
    if (!["completed", "stopped"].includes(objective.status)) add("stop", "Stop");
    if (objective.status !== "stopped") {
      for (const step of objective.steps.filter((step) => retryable.has(step.status)).slice(0, 20)) {
        add("retry_step", `Retry ${step.title}`.slice(0, 120), step.key);
      }
    }
    return list;
  }
  const controls = data.objectives.map((objective) => ({ objective, actions: actions(objective) }));

  async function run(action: SurfaceAction) {
    if (!allowed.has(objectiveActionKey(action))) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/objectives/${encodeURIComponent(action.objectiveId)}/control`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.action, stepKey: action.stepKey }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Could not update objective.");
      }
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update objective.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid items-start gap-4 lg:grid-cols-2">
    {error && <p role="alert" className="lg:col-span-2 text-sm text-(--destructive)">{error}</p>}
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Recent objectives</h2>
        <Button asChild size="sm" variant="outline"><Link href="/objectives">Objectives console</Link></Button>
      </div>
      {!controls.length && <p className="text-sm text-(--muted-foreground)">No recorded objectives in this workspace.</p>}
      {controls.map(({ objective, actions }) => <WorkforceSurface key={objective.id}
        surface={{
          version: 1, title: objective.title.slice(0, 120),
          components: [
            { id: "status", type: "text", text: statusText(objective.status) },
            ...(objective.steps.length ? [{
              id: "steps", type: "table", caption: "Steps", columns: ["Step", "Status", "What is needed"],
              rows: objective.steps.slice(0, 100).map((step) => [step.title.slice(0, 500), statusText(step.status), step.unblockRequest?.slice(0, 500) ?? "—"]),
            }] : []),
            ...actions,
          ],
        }}
        allowedActions={allowed} onAction={run} busy={busy} />)}
    </div>
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Execution activity</CardTitle><p className="text-xs text-(--muted-foreground)">Refreshes every 15 seconds while open.</p></CardHeader>
        <CardContent>
          {!data.events.length && <p className="text-sm text-(--muted-foreground)">No objective events recorded.</p>}
          <ol className="space-y-3">{data.events.map((event) => <li className="border-b border-(--border) pb-2 text-sm" key={event.id}>
            <p className="font-medium">{event.objective.title}</p><p>{event.message}</p>
            <time className="text-xs text-(--muted-foreground)" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
          </li>)}</ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Workspace tasks</CardTitle></CardHeader>
        <CardContent>
          {!data.tasks.length && <p className="text-sm text-(--muted-foreground)">No workspace-level tasks recorded.</p>}
          <ul className="space-y-2 text-sm">{data.tasks.map((task) => <li key={task.id}>{task.title} · {statusText(task.status)}{task.dueDate ? ` · Due ${new Date(task.dueDate).toLocaleDateString()}` : ""}</li>)}</ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Preview a generated interface</CardTitle></CardHeader>
        <CardContent>
          <label className="grid gap-2 text-sm">Import Sentinel surface JSON
            <input type="file" accept="application/json,.json" className="max-w-full text-xs" onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              try {
                if (file.size > 1_000_000) throw new Error();
                setImported(JSON.parse(await file.text()));
                setError("");
              } catch {
                setError("Select valid Sentinel surface JSON under 1 MB.");
              }
            }} />
          </label>
        </CardContent>
      </Card>
      {imported !== null && <WorkforceSurface surface={imported} allowedActions={allowed} onAction={run} busy={busy} />}
    </div>
  </div>;
}
