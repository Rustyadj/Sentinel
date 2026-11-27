"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";

interface SkillVersion {
  id: string;
  version: number;
  status: string;
  dependencies: string[];
  benchmarkResultIds: string[];
}

export function WorkforceSkills({ skills, canEdit, onChange }: { skills: WorkforceSnapshot["skills"]; canEdit: boolean; onChange: () => void }) {
  const [query, setQuery] = useState("");
  return <Card>
    <CardHeader><CardTitle>Skills library</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <label className="grid max-w-md gap-1 text-sm">Search skills
        <Input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {skills.length === 0 && <p className="text-sm text-(--muted-foreground)">No skills are visible in this workspace.</p>}
      {skills.filter((skill) => `${skill.name} ${skill.domain} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())).map((skill) => <article key={skill.id} className="border-t border-(--border) pt-3">
        <h3 className="text-sm font-semibold">{skill.name}</h3>
        <p className="mt-1 text-sm">{skill.description}</p>
        <p className="mt-1 text-xs text-(--muted-foreground)">{skill.domain} · {skill.status} · v{skill.version}{skill.owner ? ` · ${skill.owner}` : ""}</p>
        {!!skill.requiredTools.length && <p className="mt-1 text-xs">Required tools: {skill.requiredTools.join(", ")}</p>}
        {skill._count.versions > 0 && <details className="mt-2 text-sm">
          <summary className="cursor-pointer">Versions ({skill._count.versions})</summary>
          <VersionList skillId={skill.id} canEdit={canEdit} onChange={onChange} />
        </details>}
      </article>)}
      <Button asChild variant="outline" size="sm"><Link href="/bots">Bot skills and installation</Link></Button>
    </CardContent>
  </Card>;
}

function VersionList({ skillId, canEdit, onChange }: { skillId: string; canEdit: boolean; onChange: () => void }) {
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    const abort = new AbortController();
    fetch(`/api/learning/skill-versions?skillId=${encodeURIComponent(skillId)}`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load skill versions.");
        const versions = await response.json();
        if (!abort.signal.aborted) setVersions(versions);
      }).catch((error: Error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, [skillId, refresh, loaded]);

  async function activate(versionId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/learning/skill-versions/${encodeURIComponent(versionId)}/activate`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Activation failed.");
      }
      setRefresh((value) => value + 1);
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Activation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>Load version details</Button>;
  return <ul className="mt-2 space-y-2">
    {!versions.length && !error && <li role="status">Loading versions…</li>}
    {versions.map((version) => <li key={version.id} className="flex flex-wrap items-center gap-2">
      <span>v{version.version} · {version.status} · {version.benchmarkResultIds.length} evaluation results</span>
      {version.dependencies.length > 0 && <span className="text-xs">Dependencies: {version.dependencies.join(", ")}</span>}
      {canEdit && version.status === "draft" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void activate(version.id)}>Activate v{version.version}</Button>}
    </li>)}
    {error && <li role="alert" className="text-sm text-(--destructive)">{error}</li>}
  </ul>;
}
