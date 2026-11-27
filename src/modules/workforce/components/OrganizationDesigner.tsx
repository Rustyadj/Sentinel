"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";
import { WorkforceTeams } from "./WorkforceTeams";

type Department = WorkforceSnapshot["departments"][number];
const empty = { name: "", description: "", parentDepartmentId: "" };

export function OrganizationDesigner({ data, onSaved }: { data: WorkforceSnapshot; onSaved: () => void }) {
  const [id, setId] = useState("");
  const [form, setForm] = useState(empty);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function select(department?: Department) {
    setId(department?.id ?? "");
    setForm(department ? { name: department.name, description: department.description ?? "", parentDepartmentId: department.parentDepartmentId ?? "" } : empty);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/workforce/departments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id || undefined, workspaceId: data.workspace.id, ...form, parentDepartmentId: form.parentDepartmentId || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save department.");
      select();
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save department.");
    } finally {
      setPending(false);
    }
  }

  return <div className="grid gap-4 lg:grid-cols-2">
    <Card>
      <CardHeader><CardTitle>{data.workspace.organization ?? "Organization"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!data.workspace.organization && <p className="text-sm text-(--muted-foreground)">This workspace has no organization.</p>}
        {data.workspace.organization && data.departments.length === 0 && <p className="text-sm text-(--muted-foreground)">No departments yet.</p>}
        {data.departments.map((department) => <div key={department.id} className="flex items-start justify-between gap-2 border-b border-(--border) pb-3">
          <div>
            <p className="text-sm font-medium">{department.name}</p>
            {department.parentDepartmentId && <p className="text-xs text-(--muted-foreground)">Parent {data.departments.find((row) => row.id === department.parentDepartmentId)?.name ?? "unavailable"}</p>}
            {department.description && <p className="mt-1 text-sm">{department.description}</p>}
          </div>
          {data.access.manageDepartments && <Button variant="ghost" size="sm" disabled={pending} onClick={() => select(department)}>Edit {department.name}</Button>}
        </div>)}
      </CardContent>
    </Card>
    {data.access.manageDepartments && <Card>
      <CardHeader><CardTitle>{id ? "Edit department" : "Create department"}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <fieldset disabled={pending} className="space-y-3">
            <label className="grid gap-1 text-sm">Name<Input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Description<textarea className="rounded-md border border-(--border) bg-(--background) p-2" maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Parent department
              <select className="rounded-md border border-(--border) bg-(--background) p-2" value={form.parentDepartmentId} onChange={(event) => setForm({ ...form, parentDepartmentId: event.target.value })}>
                <option value="">Organization root</option>
                {data.departments.filter((entry) => entry.id !== id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <Button>{pending ? "Saving…" : "Save department"}</Button>
              {id && <Button type="button" variant="ghost" onClick={() => select()}>Cancel editing</Button>}
            </div>
          </fieldset>
          {error && <p className="text-sm text-(--destructive)" role="alert">{error}</p>}
        </form>
      </CardContent>
    </Card>}
    {(data.access.canReadTeams || data.access.canCreateTeams) && <WorkforceTeams data={data} onSaved={onSaved} />}
  </div>;
}
