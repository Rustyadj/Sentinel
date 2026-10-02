"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModelAgent { id: string; name: string; color: string; model: string }

interface ModelOption { id: string; state: string; efforts?: string[] }
interface ModelSettings {
  runtime: string;
  provider: string;
  config: { runtimeModelId: string; effort: string | null; source: string };
  options: ModelOption[];
  efforts: string[];
  effect: string;
}

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: "verified", configured: "configured", unverified: "unverified", unavailable: "unavailable",
};

async function readError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 403) return "Only workspace admins can view or change agent models.";
  return body?.error ?? `Request failed (${res.status})`;
}

/**
 * Per-agent model and reasoning-effort control. Reads and writes the real
 * /api/agents/[id]/model endpoint; a change applies to new sessions only, which
 * is stated rather than implied.
 */
export function ModelPicker({ agents, activeAgentId, onChanged }: {
  agents: ModelAgent[];
  activeAgentId: string | undefined;
  /** Called after a successful save so the caller can re-read agents. */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | undefined>(activeAgentId);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.id === agentId) ?? agents.find((a) => a.id === activeAgentId);
  const shownModel = settings?.config.runtimeModelId ?? agent?.model ?? "Model";

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null); setSettings(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/model`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      setSettings((await res.json()) as ModelSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load model settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const save = async (body: { model?: string; reasoningEffort?: string | null; reset?: boolean }) => {
    if (!agent) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/model`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res));
      setSettings((await res.json()) as ModelSettings);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save model settings");
    } finally {
      setSaving(false);
    }
  };

  if (!agent) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) { setOpen(false); return; }
          setAgentId(activeAgentId); setOpen(true);
          if (agent) void load(agent.id);
        }}
        className="flex max-w-[11rem] items-center gap-1.5 rounded-md border border-[--glass-border] px-2 py-1 font-mono text-[11px] text-[--muted-foreground] transition-colors hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
      >
        <SlidersHorizontal className="h-3 w-3 shrink-0" />
        <span className="truncate">{shownModel}</span>
      </button>

      {open ? (
        <div role="dialog" aria-label="Agent models" className="absolute right-0 top-[calc(100%+6px)] z-30 w-[320px] rounded-xl border border-[--glass-border] bg-[--card] p-3 shadow-[var(--shadow-lg)]">
          <div role="tablist" aria-label="Agent" className="mb-3 flex flex-wrap gap-1">
            {agents.map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={a.id === agent.id}
                onClick={() => { setAgentId(a.id); void load(a.id); }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]",
                  a.id === agent.id ? "bg-[--accent] text-[--foreground]" : "text-[--muted-foreground] hover:text-[--foreground]",
                )}
              >
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />{a.name}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="flex items-center gap-2 py-4 text-[12px] text-[--muted-foreground]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</p>
          ) : null}
          {error ? <p role="alert" className="py-2 text-[12px] text-[--destructive]">{error}</p> : null}

          {settings ? (
            <>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[--text-faint]">Model · {settings.provider}</p>
              <ul className="space-y-0.5" role="radiogroup" aria-label="Model">
                {settings.options.map((o) => {
                  const selected = o.id === settings.config.runtimeModelId;
                  return (
                    <li key={o.id}>
                      <button
                        role="radio"
                        aria-checked={selected}
                        disabled={saving || o.state === "unavailable"}
                        onClick={() => !selected && void save({ model: o.id })}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-50",
                          selected ? "bg-[--accent] text-[--foreground]" : "text-[--muted-foreground] hover:bg-[--muted] hover:text-[--foreground]",
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", selected ? "bg-[--primary]" : "bg-[--text-faint]")} />
                        <span className="flex-1 truncate font-mono">{o.id}</span>
                        <span className="text-[10.5px] text-[--text-faint]">{STATE_LABEL[o.state] ?? o.state}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {settings.efforts.length > 0 ? (
                <>
                  <p className="mb-2 mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[--text-faint]">Reasoning effort</p>
                  <div role="radiogroup" aria-label="Reasoning effort" className="flex gap-1">
                    {settings.efforts.map((effort) => (
                      <button
                        key={effort}
                        role="radio"
                        aria-checked={settings.config.effort === effort}
                        disabled={saving}
                        onClick={() => settings.config.effort !== effort && void save({ reasoningEffort: effort })}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-[12px] capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-50",
                          settings.config.effort === effort ? "border-[--primary]/40 bg-[--accent] text-[--foreground]" : "border-[--glass-border] text-[--muted-foreground] hover:text-[--foreground]",
                        )}
                      >
                        {effort}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="mt-3 flex items-center justify-between border-t border-[--glass-border] pt-2.5">
                <p className="text-[11px] text-[--text-faint]">Applies to new sessions.</p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save({ reset: true })}
                  className="flex items-center gap-1 text-[11px] text-[--muted-foreground] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />Reset to default
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
