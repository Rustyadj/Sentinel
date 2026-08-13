"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked } from "lucide-react";

interface Principle {
  id: string;
  statement: string;
  scope: string;
  domain: string | null;
  confidence: number;
  evidenceCount: number;
  currentVersion: number;
  status: string;
  updatedAt: string;
}

export function PrinciplesView() {
  const [principles, setPrinciples] = useState<Principle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/learning/principles")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setPrinciples(data);
      })
      .catch(() => setError("Could not load principles."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <BookMarked className="w-4 h-4 text-[--primary]" /> Principles
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Distilled from repeated episodic experience — never from one anecdote. Each principle is
        versioned; behavior is never silently overwritten.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 border border-red-500/20 rounded-lg p-6 text-center">{error}</div>
      ) : principles.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No principles distilled yet — they form once repeated, corroborating evidence clears the
          confidence threshold.
        </div>
      ) : (
        <div className="space-y-2">
          {principles.map((p) => (
            <div key={p.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                  v{p.currentVersion}
                </span>
                {p.domain && <span className="text-[10px] text-[--muted-foreground]">{p.domain}</span>}
                <span className="text-[10px] text-[--muted-foreground]">
                  {(p.confidence * 100).toFixed(0)}% confidence · {p.evidenceCount} evidence
                </span>
              </div>
              <p className="text-sm text-[--foreground] mt-1.5">{p.statement}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
