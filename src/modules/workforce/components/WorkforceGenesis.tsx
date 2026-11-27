"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { marketingPlan, workforcePlanSchema, type WorkforcePlan } from "@/lib/workforce/plan";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";

const control = "w-full rounded-md border border-(--border) bg-(--background) p-2 text-sm";
const emptyPlan: WorkforcePlan = { department: { name: "", description: "" }, specialists: [] };
const newAgent = (key: string): WorkforcePlan["specialists"][number] => ({
  key, name: "", specialization: "", personality: "", communicationStyle: "", responsibilities: [""],
  reportsTo: null, objectives: [{ goal: "", metric: "", cadence: "once" }], requestedCapabilities: [],
});

export function WorkforceGenesis({ workspace, canPlan, providerAvailable }: { workspace: WorkforceSnapshot["workspace"]; canPlan: boolean; providerAvailable: boolean }) {
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<WorkforcePlan | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const organization = workspace.organization ?? workspace.name;
  const canGenerate = canPlan && providerAvailable;

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/workforce/genesis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, instruction }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Plan generation failed.");
      setPlan(workforcePlanSchema.parse(body.plan));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Plan generation failed.");
    } finally {
      setPending(false);
    }
  }

  function apply(next: WorkforcePlan) {
    setPlan(next);
    setMessage("");
  }

  function updateAgent(key: string, patch: Partial<WorkforcePlan["specialists"][number]>) {
    setPlan((current) => current && ({
      ...current,
      specialists: current.specialists.map((agent) => agent.key === key ? { ...agent, ...patch } : agent),
    }));
  }

  function exportDraft() {
    const validated = workforcePlanSchema.safeParse(plan);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      setMessage(`${issue.path.join(".")}: ${issue.message}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(validated.data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sentinel-workforce-plan.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Workforce Genesis</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {canGenerate && <form onSubmit={generate} className="space-y-2">
            <label htmlFor="workforce-instruction" className="block text-sm font-medium">What should this workforce accomplish?</label>
            <textarea id="workforce-instruction" className={control} rows={3} maxLength={6000} value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Create a five-agent marketing department to research construction leads, improve SEO, produce content, monitor competitors, and report weekly." />
            <Button disabled={pending || !instruction.trim()}>{pending ? "Generating…" : "Generate plan"}</Button>
          </form>}
          {!canGenerate && <p className="text-sm text-(--muted-foreground)">
            {canPlan ? "Connect OpenRouter to generate a plan from instructions." : "Workspace configuration access is required to generate a plan."}
          </p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => apply(marketingPlan(organization))}>Marketing template</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => apply(emptyPlan)}>Start manually</Button>
            <label className="text-sm">
              <span className="sr-only">Import a workforce draft</span>
              <input type="file" accept="application/json,.json" disabled={pending} className="max-w-full text-xs"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  try {
                    if (file.size > 500_000) throw new Error("Draft files must be under 500 KB.");
                    apply(workforcePlanSchema.parse(JSON.parse(await file.text())));
                  } catch {
                    setMessage("Select a valid Sentinel workforce plan JSON file under 500 KB.");
                  }
                }} />
            </label>
          </div>
          <p className="text-xs text-(--muted-foreground)">Plans are editable drafts. Agent activation depends on runtime provisioning.</p>
          {message && <p role="alert" className="text-sm text-(--destructive)">{message}</p>}
        </CardContent>
      </Card>
      {plan && <Card>
        <CardHeader><CardTitle>Department draft</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="grid gap-1 text-sm">Department name
            <Input maxLength={120} value={plan.department.name} onChange={(event) => apply({ ...plan, department: { ...plan.department, name: event.target.value } })} />
          </label>
          <label className="grid gap-1 text-sm">Business objective
            <textarea className={control} maxLength={2000} value={plan.department.description} onChange={(event) => apply({ ...plan, department: { ...plan.department, description: event.target.value } })} />
          </label>
          {plan.specialists.map((agent, index) => <fieldset key={agent.key} className="grid gap-3 rounded-md border border-(--border) p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{agent.name || `Agent ${index + 1}`}</legend>
            <label className="grid gap-1 text-sm">Name<Input value={agent.name} onChange={(event) => updateAgent(agent.key, { name: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Specialization<Input value={agent.specialization} onChange={(event) => updateAgent(agent.key, { specialization: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Personality<textarea className={control} value={agent.personality} onChange={(event) => updateAgent(agent.key, { personality: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Communication style<Input value={agent.communicationStyle} onChange={(event) => updateAgent(agent.key, { communicationStyle: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Responsibilities, one per line<textarea className={control} value={agent.responsibilities.join("\n")} onChange={(event) => updateAgent(agent.key, { responsibilities: event.target.value.split("\n") })} /></label>
            <label className="grid gap-1 text-sm">Requested capabilities, one per line<textarea className={control} value={agent.requestedCapabilities.join("\n")}
              onChange={(event) => updateAgent(agent.key, { requestedCapabilities: event.target.value ? event.target.value.split("\n") : [] })} /></label>
            <label className="grid gap-1 text-sm">Reports to
              <select className={control} value={agent.reportsTo ?? ""} onChange={(event) => updateAgent(agent.key, { reportsTo: event.target.value || null })}>
                <option value="">Department lead</option>
                {plan.specialists.filter((candidate) => candidate.key !== agent.key).map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.name || candidate.key}</option>)}
              </select>
            </label>
            {agent.objectives.map((objective, objectiveIndex) => (
              <fieldset key={objectiveIndex} className="grid gap-2 rounded-md border border-(--border) p-2 sm:col-span-2 sm:grid-cols-3">
                <legend className="px-1 text-xs">Objective {objectiveIndex + 1}</legend>
                <label className="grid gap-1 text-sm">Goal<Input value={objective.goal} onChange={(event) => updateAgent(agent.key, { objectives: agent.objectives.map((entry, i) => i === objectiveIndex ? { ...entry, goal: event.target.value } : entry) })} /></label>
                <label className="grid gap-1 text-sm">Measure<Input value={objective.metric} onChange={(event) => updateAgent(agent.key, { objectives: agent.objectives.map((entry, i) => i === objectiveIndex ? { ...entry, metric: event.target.value } : entry) })} /></label>
                <label className="grid gap-1 text-sm">Cadence<select className={control} value={objective.cadence} onChange={(event) => updateAgent(agent.key, { objectives: agent.objectives.map((entry, i) => i === objectiveIndex ? { ...entry, cadence: event.target.value as typeof objective.cadence } : entry) })}>
                  <option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select></label>
                {agent.objectives.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => updateAgent(agent.key, { objectives: agent.objectives.filter((_, i) => i !== objectiveIndex) })}>Remove objective</Button>}
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="button" variant="outline" size="sm" disabled={agent.objectives.length >= 10} onClick={() => updateAgent(agent.key, { objectives: [...agent.objectives, { goal: "", metric: "", cadence: "once" }] })}>Add objective</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => apply({ ...plan, specialists: plan.specialists.filter((entry) => entry.key !== agent.key).map((entry) => entry.reportsTo === agent.key ? { ...entry, reportsTo: null } : entry) })}>Remove agent</Button>
            </div>
          </fieldset>)}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={plan.specialists.length >= 20} onClick={() => apply({ ...plan, specialists: [...plan.specialists, newAgent(`agent-${crypto.randomUUID().replaceAll("-", "")}`)] })}>Add agent</Button>
            <Button onClick={exportDraft}>Export draft</Button>
          </div>
        </CardContent>
      </Card>}
    </div>
  );
}
