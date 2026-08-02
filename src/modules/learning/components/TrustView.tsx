"use client";

import { useState } from "react";
import { History, ShieldCheck } from "lucide-react";

interface TrustProfile {
  agentId: string;
  domains: Array<{
    id: string;
    domain: string;
    score: number;
    evidenceCount: number;
    successRate: number;
    lastEvaluatedAt: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    domain: string | null;
    eventType: string;
    delta: number;
    reason: string;
    createdAt: string;
  }>;
}

export function TrustView() {
  const [agentId, setAgentId] = useState("");
  const [profile, setProfile] = useState<TrustProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile(event: React.FormEvent) {
    event.preventDefault();
    const query = agentId.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/learning/trust?agentId=${encodeURIComponent(query)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load trust profile");
      setProfile(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-[--foreground]">
        <ShieldCheck className="h-4 w-4 text-[--primary]" /> Trust History
      </h1>
      <p className="mb-6 mt-1 max-w-2xl text-sm text-[--muted-foreground]">
        Per-domain capability trust backed by an event history. Trust can qualify low-risk
        automation, but never replaces Tier 3 authorization or approval.
      </p>

      <form onSubmit={loadProfile} className="mb-6 flex max-w-xl gap-2">
        <input
          required
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
          placeholder="Agent ID"
          className="min-w-0 flex-1 rounded-md border border-[--sidebar-border] bg-[--card] px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-[--primary] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load profile"}
        </button>
      </form>

      {error ? <p className="mb-3 text-xs text-red-400">{error}</p> : null}
      {!profile ? (
        <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
          Enter an agent id to inspect capability-specific trust.
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[--muted-foreground]">
              Domain competency
            </h2>
            {profile.domains.length === 0 ? (
              <p className="text-xs text-[--muted-foreground]">No competency evidence yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {profile.domains.map((domain) => (
                  <article key={domain.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium capitalize text-[--foreground]">
                        {domain.domain.replaceAll("_", " ")}
                      </h3>
                      <span className="text-lg font-semibold text-[--foreground]">
                        {Math.round(domain.score * 100)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-[--primary]"
                        style={{ width: `${Math.round(domain.score * 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] text-[--muted-foreground]">
                      <span>{domain.evidenceCount} evidence events</span>
                      <span>{Math.round(domain.successRate * 100)}% positive</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[--muted-foreground]">
              <History className="h-3.5 w-3.5" /> Recent events
            </h2>
            {profile.recentEvents.length === 0 ? (
              <p className="text-xs text-[--muted-foreground]">No trust history yet.</p>
            ) : (
              <div className="space-y-2">
                {profile.recentEvents.map((event) => (
                  <article key={event.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium capitalize text-[--foreground]">
                        {event.domain?.replaceAll("_", " ") ?? "unscoped"}
                      </span>
                      <span className="text-[--muted-foreground]">{event.eventType.replaceAll("_", " ")}</span>
                      <span className={`ml-auto font-medium ${event.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {event.delta >= 0 ? "+" : ""}{event.delta}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[--muted-foreground]">{event.reason}</p>
                    <time className="mt-1 block text-[10px] text-[--muted-foreground]">
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
