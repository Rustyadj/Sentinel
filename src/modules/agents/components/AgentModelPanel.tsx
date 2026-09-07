"use client";
import { useEffect, useState } from "react";

type Settings = {
  runtime: string; provider: string; config: { runtimeModelId: string; effort: string | null; source: string };
  options: { id: string; state: string; efforts: string[] }[]; efforts: string[]; availability: string;
  effect: string; lastSession: { metadata: Record<string, unknown> } | null;
};
export function AgentModelPanel({ agentId }: { agentId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/agents/${encodeURIComponent(agentId)}/model`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setSettings(value); setModel(value.config.runtimeModelId); setEffort(value.config.effort ?? "");
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, [agentId]);
  async function save(reset = false) {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/model`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, reasoningEffort: effort || null, reset }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setSettings(value); setModel(value.config.runtimeModelId); setEffort(value.config.effort ?? "");
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  const supportedEfforts = settings?.options.find(option => option.id === model)?.efforts ?? [];
  const last = settings?.lastSession?.metadata;
  return <section className="min-w-0 rounded-xl border border-[--border] bg-[--card] p-4" aria-label="Agent model configuration">
    <h3 className="text-sm font-medium">Model</h3>
    {error && <p role="alert" className="my-2 text-sm text-red-400">{error}</p>}
    {settings ? <>
      <dl className="my-3 grid grid-cols-2 gap-2 break-words text-xs">
        <dt>Current model</dt><dd>{settings.config.runtimeModelId}</dd>
        <dt>Current effort</dt><dd>{settings.config.effort ?? "Runtime default"}</dd>
        <dt>Provider / runtime</dt><dd>{settings.provider} / {settings.runtime}</dd>
        <dt>Configuration source</dt><dd>{settings.config.source}</dd>
        <dt>Runtime availability</dt><dd>{settings.availability}</dd>
        <dt>Last session requested</dt><dd>{typeof last?.requestedModel === "string" ? last.requestedModel : "Not recorded"} / {String(last?.requestedEffort ?? "Not recorded")}</dd>
        <dt>Last session actual</dt><dd>{String(last?.actualModel ?? "Not reported")} / {String(last?.actualEffort ?? "Not reported")}</dd>
      </dl>
      {last?.actualModel && last.actualModel !== last.requestedModel ? <p role="status" className="mb-3 text-xs text-amber-400">The runtime reported a different model from the request.</p> : null}
      <label className="block text-xs">Model<input aria-label="Model" list={`models-${agentId}`} value={model} onChange={e => setModel(e.target.value)} className="my-2 w-full rounded border border-[--border] bg-[--background] p-2" /></label>
      <datalist id={`models-${agentId}`}>{settings.options.map(option => <option key={option.id} value={option.id}>{option.state}</option>)}</datalist>
      {supportedEfforts.length > 0 && <label className="block text-xs">Effort<select aria-label="Effort" value={effort} onChange={e => setEffort(e.target.value)} className="my-2 w-full rounded border border-[--border] bg-[--background] p-2"><option value="">Runtime default</option>{supportedEfforts.map(value => <option key={value}>{value}</option>)}</select></label>}
      <p className="my-3 text-xs text-[--muted-foreground]">Applies to new sessions. Running and historical sessions retain their original configuration. Unverified models require a successful runtime execution; unavailable models require you to choose a fallback.</p>
      <div className="flex flex-wrap gap-3"><button disabled={saving} onClick={() => void save()} className="rounded border border-[--border] px-3 py-2 text-xs">{saving ? "Saving…" : "Save"}</button><button disabled={saving} onClick={() => void save(true)} className="rounded border border-[--border] px-3 py-2 text-xs">Reset to Sentinel default</button></div>
    </> : <p className="mt-2 text-xs">Loading model configuration…</p>}
  </section>;
}
