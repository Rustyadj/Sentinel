"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MissionContextLevel } from "@/lib/mission-control/types";

export function ContextStrip({ levels: providedLevels }: { levels?: MissionContextLevel[] }) {
  const [levels, setLevels] = useState<MissionContextLevel[]>(providedLevels ?? []);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((providedLevels ?? []).map((level) => [level.id, level.value])));
  const [state, setState] = useState<"loading" | "live" | "unavailable">(providedLevels ? "live" : "loading");

  useEffect(() => {
    if (providedLevels) return;
    const controller = new AbortController();
    fetch("/api/workspaces", { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Workspace context returned ${response.status}`);
        const body = await response.json() as { workspaces?: Array<{ name: string }> };
        const names = (body.workspaces ?? []).map((workspace) => workspace.name);
        const next = names.length ? [{ id: "workspace" as const, label: "Workspace", value: names[0], options: names }] : [];
        setLevels(next);
        setValues(Object.fromEntries(next.map((level) => [level.id, level.value])));
        setState("live");
      })
      .catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => controller.abort();
  }, [providedLevels]);

  const updateContext = (id: string, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
    window.dispatchEvent(new CustomEvent("sentinel:mission-context", { detail: { id, value } }));
  };

  return (
    <nav aria-label="Mission Control context" className="relative z-35 flex min-h-11 shrink-0 items-center border-b border-[#182338] bg-[#07101b]/96 px-3 backdrop-blur-xl">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {levels.map((level, index) => (
          <div key={level.id} className="flex shrink-0 items-center gap-1">
            {index > 0 ? <ChevronRight aria-hidden className="h-3 w-3 text-[#46556a]" /> : null}
            <label className="group relative flex h-8 min-w-[104px] cursor-pointer items-center gap-2 rounded-md px-2 outline-none transition-colors hover:bg-white/[0.04] focus-within:ring-2 focus-within:ring-violet-400/50">
              <span className="flex min-w-0 flex-col">
                <span className="text-[7px] font-semibold uppercase tracking-[0.08em] text-[#66758a]">{level.label}</span>
                <span className="max-w-[138px] truncate text-[9px] font-medium text-[#d4dbe6]">{values[level.id]}</span>
              </span>
              <ChevronDown aria-hidden className="ml-auto h-3 w-3 text-[#657287]" />
              <select
                aria-label={`Change ${level.label}`}
                value={values[level.id]}
                onChange={(event) => updateContext(level.id, event.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {level.options.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
      {levels.length === 0 ? <span className="text-[9px] text-[#718095]">{state === "loading" ? "Loading workspace context…" : state === "unavailable" ? "Workspace context unavailable" : "No accessible workspaces"}</span> : null}
      <div className="hidden shrink-0 items-center gap-2 pl-3 text-[8px] text-[#657287] sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${state === "live" ? "bg-emerald-400" : state === "loading" ? "bg-amber-400" : "bg-slate-400"}`} />Context {state}</div>
    </nav>
  );
}
