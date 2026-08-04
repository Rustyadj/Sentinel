"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings, Save } from "lucide-react";

interface LearningSettingsFields {
  curiosityThreshold: string;
  minShadowSampleSize: string;
  dailyLearningBudgetUsd: string;
  perAgentBudgetUsd: string;
  maxSandboxConcurrency: string;
  modelAllowlist: string;
  autoDeployEnabled: boolean;
}

const EMPTY_FORM: LearningSettingsFields = {
  curiosityThreshold: "",
  minShadowSampleSize: "",
  dailyLearningBudgetUsd: "",
  perAgentBudgetUsd: "",
  maxSandboxConcurrency: "",
  modelAllowlist: "",
  autoDeployEnabled: false,
};

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function LearningSettingsView() {
  const [scopeId, setScopeId] = useState("");
  const [form, setForm] = useState<LearningSettingsFields>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const load = useCallback((id: string) => {
    if (!id.trim()) {
      setLoaded(true);
      return;
    }
    setError(null);
    setLoaded(false);
    fetch(`/api/learning/settings?scopeType=workspace&scopeId=${encodeURIComponent(id.trim())}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        if (!data) {
          setForm(EMPTY_FORM);
          return;
        }
        setForm({
          curiosityThreshold: data.curiosityThreshold?.toString() ?? "",
          minShadowSampleSize: data.minShadowSampleSize?.toString() ?? "",
          dailyLearningBudgetUsd: data.dailyLearningBudgetUsd?.toString() ?? "",
          perAgentBudgetUsd: data.perAgentBudgetUsd?.toString() ?? "",
          maxSandboxConcurrency: data.maxSandboxConcurrency?.toString() ?? "",
          modelAllowlist: (data.modelAllowlist ?? []).join(", "),
          autoDeployEnabled: Boolean(data.autoDeployEnabled),
        });
      })
      .catch(() => setError("Could not load settings for this workspace — you may not have access, or none are set yet."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => load(scopeId), 400); // debounce as the user types a workspace id
    return () => clearTimeout(timeout);
  }, [scopeId, load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!scopeId.trim()) {
      setError("Enter a workspace id first.");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const response = await fetch("/api/learning/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType: "workspace",
          scopeId: scopeId.trim(),
          curiosityThreshold: toNumberOrNull(form.curiosityThreshold),
          minShadowSampleSize: toNumberOrNull(form.minShadowSampleSize),
          dailyLearningBudgetUsd: toNumberOrNull(form.dailyLearningBudgetUsd),
          perAgentBudgetUsd: toNumberOrNull(form.perAgentBudgetUsd),
          maxSandboxConcurrency: toNumberOrNull(form.maxSandboxConcurrency),
          modelAllowlist: form.modelAllowlist.split(",").map((s) => s.trim()).filter(Boolean),
          autoDeployEnabled: form.autoDeployEnabled,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? `Save failed (${response.status})`);
      setSavedAt(new Date());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Settings className="w-4 h-4 text-[--primary]" /> Learning Settings
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Real, persisted overrides for one workspace — layered over organization and system
        defaults (agent-level overrides, when set, win over these). Values left blank fall back to
        the next layer down; see <code>src/lib/learning/settings.ts</code> for the resolution order
        and hardcoded system defaults.
      </p>

      <div className="mb-4">
        <label className="block text-[10px] uppercase tracking-wide text-[--muted-foreground] mb-1">
          Workspace id
        </label>
        <input
          value={scopeId}
          onChange={(event) => setScopeId(event.target.value)}
          placeholder="workspace id you have access to"
          className="w-full rounded-md border border-[--sidebar-border] bg-transparent px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
      </div>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
      {savedAt && <p className="mb-3 text-xs text-emerald-400">Saved at {savedAt.toLocaleTimeString()}.</p>}

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : (
        <form onSubmit={save} className="space-y-3 rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
          <fieldset disabled={!scopeId.trim()} className="space-y-3 disabled:opacity-50">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-[--muted-foreground]">
                Curiosity threshold (0–1)
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={form.curiosityThreshold}
                  onChange={(e) => setForm((c) => ({ ...c, curiosityThreshold: e.target.value }))}
                  placeholder="default 0.6"
                  className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
                />
              </label>
              <label className="text-xs text-[--muted-foreground]">
                Min shadow sample size
                <input
                  type="number" min={1}
                  value={form.minShadowSampleSize}
                  onChange={(e) => setForm((c) => ({ ...c, minShadowSampleSize: e.target.value }))}
                  placeholder="default 5"
                  className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
                />
              </label>
              <label className="text-xs text-[--muted-foreground]">
                Daily learning budget (USD)
                <input
                  type="number" min={0} step={1}
                  value={form.dailyLearningBudgetUsd}
                  onChange={(e) => setForm((c) => ({ ...c, dailyLearningBudgetUsd: e.target.value }))}
                  placeholder="default 50"
                  className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
                />
              </label>
              <label className="text-xs text-[--muted-foreground]">
                Per-agent budget (USD)
                <input
                  type="number" min={0} step={1}
                  value={form.perAgentBudgetUsd}
                  onChange={(e) => setForm((c) => ({ ...c, perAgentBudgetUsd: e.target.value }))}
                  placeholder="default 10"
                  className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
                />
              </label>
              <label className="text-xs text-[--muted-foreground]">
                Max sandbox concurrency
                <input
                  type="number" min={1}
                  value={form.maxSandboxConcurrency}
                  onChange={(e) => setForm((c) => ({ ...c, maxSandboxConcurrency: e.target.value }))}
                  placeholder="default 2"
                  className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
                />
              </label>
              <label className="flex items-end gap-2 text-xs text-[--muted-foreground] pb-1.5">
                <input
                  type="checkbox"
                  checked={form.autoDeployEnabled}
                  onChange={(e) => setForm((c) => ({ ...c, autoDeployEnabled: e.target.checked }))}
                />
                Auto-deploy enabled
              </label>
            </div>
            <label className="block text-xs text-[--muted-foreground]">
              Model allowlist (comma-separated)
              <input
                value={form.modelAllowlist}
                onChange={(e) => setForm((c) => ({ ...c, modelAllowlist: e.target.value }))}
                placeholder="empty = no restriction beyond org/system defaults"
                className="mt-1 w-full rounded-md border border-[--sidebar-border] bg-transparent px-2 py-1.5 text-[--foreground]"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-1.5 rounded-md bg-[--primary] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save workspace settings"}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
