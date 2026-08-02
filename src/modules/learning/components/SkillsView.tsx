"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, GitBranch, Plus } from "lucide-react";

interface SkillSummary {
  id: string;
  name: string;
  domain: string;
  status: string;
  version: number;
  _count: { versions: number };
}

interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  implementationType: string | null;
  implementation: unknown;
  dependencies: string[];
  status: string;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

const EMPTY_FORM = {
  implementationType: "typescript",
  implementation: "{}",
  dependencies: "",
  approvalLevel: 2,
};

export function SkillsView() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillId, setSkillId] = useState("");
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchVersions = useCallback(async (selectedSkillId: string) => {
    if (!selectedSkillId) {
      return [] as SkillVersion[];
    }
    const response = await fetch(
      `/api/learning/skill-versions?skillId=${encodeURIComponent(selectedSkillId)}`,
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load skill versions");
    return result as SkillVersion[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/learning/skills")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load skills");
        return result as SkillSummary[];
      })
      .then((result) => {
        if (cancelled) return;
        setSkills(result);
        setSkillId((current) => current || result[0]?.id || "");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchVersions(skillId)
      .then((result) => {
        if (!cancelled) setVersions(result);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchVersions, skillId]);

  async function createVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!skillId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/learning/skill-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId,
          implementationType: form.implementationType,
          implementation: JSON.parse(form.implementation),
          dependencies: form.dependencies
            .split(",")
            .map((dependency) => dependency.trim())
            .filter(Boolean),
          approvalLevel: form.approvalLevel,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create skill version");
      setForm(EMPTY_FORM);
      setVersions(await fetchVersions(skillId));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setSaving(false);
    }
  }

  async function activate(versionId: string) {
    setBusyId(versionId);
    setError(null);
    try {
      const response = await fetch(`/api/learning/skill-versions/${versionId}/activate`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not activate skill version");
      setVersions(await fetchVersions(skillId));
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : String(activateError));
    } finally {
      setBusyId(null);
    }
  }

  const selectedSkill = skills.find((skill) => skill.id === skillId);

  return (
    <div className="max-w-5xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-[--foreground]">
        <GitBranch className="h-4 w-4 text-[--primary]" /> Skill Versions
      </h1>
      <p className="mb-6 mt-1 max-w-2xl text-sm text-[--muted-foreground]">
        Immutable implementation history with one active version per skill. Level 1 changes can
        activate immediately; Level 2 and 3 changes remain drafts until explicitly promoted.
      </p>

      {error ? <p className="mb-3 text-xs text-red-400">{error}</p> : null}

      {!loaded ? (
        <p className="text-xs text-[--muted-foreground]">Loading…</p>
      ) : skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
          No skills exist yet. Promote a Neural Engine skill before creating version history.
        </div>
      ) : (
        <>
          <label className="mb-4 block max-w-xl text-xs text-[--muted-foreground]">
            Skill
            <select
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
              className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-[--card] px-3 py-2 text-xs text-[--foreground] outline-none"
            >
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} · {skill.domain} · v{skill.version}
                </option>
              ))}
            </select>
          </label>

          <form onSubmit={createVersion} className="mb-6 grid gap-3 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-3">
            <input
              value={form.implementationType}
              onChange={(event) => setForm((current) => ({ ...current, implementationType: event.target.value }))}
              placeholder="Implementation type"
              className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
            />
            <input
              value={form.dependencies}
              onChange={(event) => setForm((current) => ({ ...current, dependencies: event.target.value }))}
              placeholder="Dependencies, comma-separated"
              className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
            />
            <select
              value={form.approvalLevel}
              onChange={(event) => setForm((current) => ({ ...current, approvalLevel: Number(event.target.value) }))}
              className="rounded-md border border-[--sidebar-border] bg-[--card] px-3 py-2 text-xs text-[--foreground] outline-none"
            >
              <option value={1}>Level 1 · activate</option>
              <option value={2}>Level 2 · draft</option>
              <option value={3}>Level 3 · draft</option>
            </select>
            <textarea
              required
              value={form.implementation}
              onChange={(event) => setForm((current) => ({ ...current, implementation: event.target.value }))}
              placeholder="Implementation JSON"
              rows={4}
              className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 font-mono text-xs text-[--foreground] outline-none focus:border-[--primary]/60 md:col-span-3"
            />
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-1.5 rounded-md bg-[--primary] px-3 py-2 text-xs font-medium text-white disabled:opacity-50 md:col-span-3"
            >
              <Plus className="h-3.5 w-3.5" /> {saving ? "Creating…" : "Create version"}
            </button>
          </form>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[--muted-foreground]">
              {selectedSkill?.name} history
            </h2>
            {versions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
                No versions recorded yet. The first version becomes the active baseline.
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((version) => (
                  <article key={version.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[--foreground]">Version {version.version}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${version.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-[--muted-foreground]"}`}>
                            {version.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[--muted-foreground]">
                          {version.implementationType ?? "unspecified"}
                          {version.dependencies.length ? ` · ${version.dependencies.join(", ")}` : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[--muted-foreground]">
                          <span>created {new Date(version.createdAt).toLocaleString()}</span>
                          {version.activatedAt ? <span>activated {new Date(version.activatedAt).toLocaleString()}</span> : null}
                          {version.retiredAt ? <span>retired {new Date(version.retiredAt).toLocaleString()}</span> : null}
                        </div>
                      </div>
                      {version.status === "draft" || version.status === "candidate" || version.status === "shadow" ? (
                        <button
                          type="button"
                          disabled={busyId === version.id}
                          onClick={() => activate(version.id)}
                          className="flex items-center gap-1.5 rounded-md border border-[--sidebar-border] px-2.5 py-1.5 text-xs text-[--muted-foreground] hover:text-[--foreground] disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
