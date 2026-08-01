"use client";

import { useEffect, useState } from "react";
import { Brain, Loader2, HelpCircle, Lightbulb } from "lucide-react";
import type { Reflection } from "../types";

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[--muted-foreground]">{label}</div>
      <p className="text-xs text-[--foreground] leading-relaxed">{value}</p>
    </div>
  );
}

export function ReflectionView() {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/learning-core/reflection")
      .then((r) => r.json())
      .then(setReflections)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Brain className="w-4 h-4 text-[--primary]" /> Reflection
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Structured post-task reflection: what went well, what surprised the agent, what it got
        wrong. Missing-info reflections automatically seed a Knowledge Gap.
      </p>

      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : reflections.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No reflections recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {reflections.map((r) => (
            <div key={r.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3 space-y-2">
              <div className="flex items-center gap-2">
                {r.agent && (
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
                    style={{ backgroundColor: r.agent.color + "22" }}
                  >
                    {r.agent.avatar}
                  </span>
                )}
                <span className="text-xs font-medium text-[--foreground]">
                  {r.agent?.name ?? r.agentId}
                </span>
                {r.taskRef && <span className="text-[10px] text-[--muted-foreground] truncate">{r.taskRef}</span>}
                {r.shouldAskMore && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400">
                    <HelpCircle className="w-3 h-3" /> should ask more next time
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Went well" value={r.wentWell} />
                <Field label="Went wrong" value={r.wentWrong} />
                <Field label="Surprises" value={r.surprises} />
                <Field label="Wrong assumptions" value={r.wrongAssumptions} />
                <Field label="Missing info" value={r.missingInfo} />
                <Field label="Should remember" value={r.shouldRemember} />
              </div>
              {r.skillIdea && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 pt-1 border-t border-[--sidebar-border]">
                  <Lightbulb className="w-3 h-3 shrink-0" /> Skill idea: {r.skillIdea}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
