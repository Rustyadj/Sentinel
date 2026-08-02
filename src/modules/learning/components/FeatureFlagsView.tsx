"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Power, Plus } from "lucide-react";

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scopeType: string;
  scopeId: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  variant: string | null;
  riskTier: string;
}

const ROLLOUT_PRESETS = [0, 25, 50, 100] as const;

export function FeatureFlagsView() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    key: "",
    name: "",
    // "global"/"organization" scope always fails to create — this repo has
    // no system/organization-admin authorization model, so
    // requireFeatureFlagAccess fails closed for both. "workspace" is the
    // narrowest scope every authorized user can actually create.
    scopeType: "workspace",
    scopeId: "",
    rolloutPercentage: 0,
    riskTier: "low",
  });

  const load = useCallback(() => {
    fetch("/api/learning/feature-flags")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(setFlags)
      .catch(() => setError("Could not load feature flags."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/learning/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          scopeId: form.scopeType === "global" ? null : form.scopeId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create feature flag");
      setForm((current) => ({ ...current, key: "", name: "" }));
      load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setSaving(false);
    }
  }

  async function patchFlag(id: string, updates: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/learning/feature-flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update feature flag");
      setFlags((current) => current.map((flag) => flag.id === id ? result : flag));
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : String(patchError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-5xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-[--foreground]">
        <Flag className="h-4 w-4 text-[--primary]" /> Feature Flags
      </h1>
      <p className="mb-6 mt-1 max-w-2xl text-sm text-[--muted-foreground]">
        Deterministic percentage rollouts with scope controls and an immediate kill switch.
        Disabled always wins, regardless of rollout percentage.
      </p>

      <form onSubmit={create} className="mb-6 grid gap-3 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-3">
        <input
          required
          value={form.key}
          onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
          placeholder="flag-key"
          className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <input
          required
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Flag name"
          className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <select
          value={form.scopeType}
          onChange={(event) => setForm((current) => ({ ...current, scopeType: event.target.value }))}
          className="rounded-md border border-[--sidebar-border] bg-[--card] px-3 py-2 text-xs text-[--foreground] outline-none"
        >
          {/* "global"/"organization" omitted — this repo has no admin
              authorization model, so creating a flag at either scope always
              fails closed. Offering them would just be a guaranteed error. */}
          {(["workspace", "project", "user", "agent"] as const).map((scope) => (
            <option key={scope} value={scope}>{scope}</option>
          ))}
        </select>
        <input
          required
          value={form.scopeId}
          onChange={(event) => setForm((current) => ({ ...current, scopeId: event.target.value }))}
          placeholder={`${form.scopeType} id`}
          className="rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <select
          value={form.riskTier}
          onChange={(event) => setForm((current) => ({ ...current, riskTier: event.target.value }))}
          className="rounded-md border border-[--sidebar-border] bg-[--card] px-3 py-2 text-xs text-[--foreground] outline-none"
        >
          <option value="low">low risk</option>
          <option value="medium">medium risk</option>
          <option value="high">high risk</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-[--muted-foreground]">
          Rollout
          <input
            type="number"
            min={0}
            max={100}
            value={form.rolloutPercentage}
            onChange={(event) => setForm((current) => ({
              ...current,
              rolloutPercentage: Number(event.target.value),
            }))}
            className="w-20 rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
          />
          %
        </label>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-md bg-[--primary] px-3 py-2 text-xs font-medium text-white disabled:opacity-50 md:col-span-3"
        >
          <Plus className="h-3.5 w-3.5" /> {saving ? "Creating…" : "Create disabled flag"}
        </button>
      </form>

      {error ? <p className="mb-3 text-xs text-red-400">{error}</p> : null}
      {!loaded ? (
        <p className="text-xs text-[--muted-foreground]">Loading…</p>
      ) : flags.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
          No feature flags configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => (
            <article key={flag.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium text-[--foreground]">{flag.name}</h2>
                    <code className="text-[10px] text-[--muted-foreground]">{flag.key}</code>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${flag.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                      {flag.enabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[--muted-foreground]">
                    {flag.scopeType}{flag.scopeId ? ` · ${flag.scopeId}` : ""} · {flag.riskTier} risk
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === flag.id}
                  onClick={() => patchFlag(flag.id, { enabled: !flag.enabled })}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${flag.enabled ? "border-red-500/30 text-red-400" : "border-[--sidebar-border] text-[--muted-foreground]"}`}
                >
                  <Power className="h-3.5 w-3.5" /> {flag.enabled ? "Kill switch" : "Enable"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[--sidebar-border] pt-3">
                <span className="mr-1 text-xs text-[--muted-foreground]">Rollout {flag.rolloutPercentage}%</span>
                {ROLLOUT_PRESETS.map((percentage) => (
                  <button
                    key={percentage}
                    type="button"
                    disabled={busyId === flag.id || flag.rolloutPercentage === percentage}
                    onClick={() => patchFlag(flag.id, { rolloutPercentage: percentage })}
                    className="rounded-md border border-[--sidebar-border] px-2 py-1 text-[10px] text-[--muted-foreground] hover:text-[--foreground] disabled:opacity-40"
                  >
                    {percentage}%
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
