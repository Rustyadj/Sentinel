"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Heart, Plus } from "lucide-react";

interface PreferenceEvidence {
  id: string;
  sourceType: string;
  evidence: string;
  evidenceWeight: number;
  supportsPreference: boolean;
  observedAt: string;
  metadata: { preferenceKey?: string; observedValue?: string };
  memory: {
    id: string;
    content: string;
    confidence: number;
  };
}

const SOURCE_TYPES = [
  ["explicit_user_statement", "Explicit statement"],
  ["explicit_correction", "Explicit correction"],
  ["explicit_approval", "Explicit approval"],
  ["repeated_observed_behavior", "Repeated behavior"],
  ["single_implicit_behavior", "Single implicit behavior"],
  ["model_inference", "Model inference"],
] as const;

export function PreferencesView() {
  const [evidence, setEvidence] = useState<PreferenceEvidence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    key: "",
    value: "",
    sourceType: "explicit_user_statement",
    evidence: "",
  });

  const load = useCallback(() => {
    fetch(`/api/learning/preferences${conflictsOnly ? "?conflicts=true" : ""}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(setEvidence)
      .catch(() => setError("Could not load preference evidence."))
      .finally(() => setLoaded(true));
  }, [conflictsOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/learning/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not record evidence");
      setForm((current) => ({ ...current, evidence: "" }));
      load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[--foreground]">
            <Heart className="h-4 w-4 text-[--primary]" /> Preferences
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[--muted-foreground]">
            Canonical preference memories backed by weighted, auditable evidence. Conflicting
            observations are flagged instead of overwriting what the user previously established.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-[--muted-foreground]">
          <input
            type="checkbox"
            checked={conflictsOnly}
            onChange={(event) => {
              setLoaded(false);
              setConflictsOnly(event.target.checked);
            }}
          />
          Conflicts only
        </label>
      </div>

      <form
        onSubmit={submit}
        className="mb-6 grid gap-3 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-2"
      >
        <input
          required
          value={form.key}
          onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
          placeholder="Preference key, e.g. response tone"
          className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <input
          required
          value={form.value}
          onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))}
          placeholder="Observed value, e.g. concise"
          className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <select
          value={form.sourceType}
          onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))}
          className="rounded-md border border-[--sidebar-border] bg-[--card] px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        >
          {SOURCE_TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          required
          value={form.evidence}
          onChange={(event) => setForm((current) => ({ ...current, evidence: event.target.value }))}
          placeholder="What was observed?"
          className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-md bg-[--primary] px-3 py-2 text-xs font-medium text-white disabled:opacity-50 md:col-span-2"
        >
          <Plus className="h-3.5 w-3.5" /> {saving ? "Recording…" : "Record evidence"}
        </button>
      </form>

      {error ? <p className="mb-3 text-xs text-red-400">{error}</p> : null}
      {!loaded ? (
        <p className="text-xs text-[--muted-foreground]">Loading…</p>
      ) : evidence.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
          No preference evidence recorded yet.
        </div>
      ) : (
        <div className="space-y-2">
          {evidence.map((item) => (
            <article key={item.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-[--foreground]">
                  {item.metadata.preferenceKey?.replaceAll("_", " ") ?? "Preference"}: {item.memory.content}
                </span>
                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-[--muted-foreground]">
                  confidence {item.memory.confidence.toFixed(3)}
                </span>
                {!item.supportsPreference ? (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> conflict: {item.metadata.observedValue}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-[--muted-foreground]">{item.evidence}</p>
              <div className="mt-2 flex gap-2 text-[10px] text-[--muted-foreground]">
                <span>{item.sourceType.replaceAll("_", " ")}</span>
                <span>weight {item.evidenceWeight.toFixed(1)}</span>
                <span>{new Date(item.observedAt).toLocaleString()}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
