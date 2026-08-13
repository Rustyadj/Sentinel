"use client";

import { useCallback, useEffect, useState } from "react";
import { Dna, Crown } from "lucide-react";

interface Candidate {
  id: string;
  type: string;
  survivalStatus: string;
  generation: number;
  lineageDepth: number;
  fitnessScore: number | null;
  noveltyScore: number | null;
  championGroup: string | null;
  mutationType: string | null;
  createdAt: string;
}

interface ChampionGroup {
  championGroup: string;
  champion: Candidate | null;
  challengers: Candidate[];
}

const STATUS_COLOR: Record<string, string> = {
  champion: "bg-amber-500/15 text-amber-400",
  challenger: "bg-violet-500/15 text-violet-400",
  testing: "bg-sky-500/15 text-sky-400",
  archive: "bg-white/5 text-[--muted-foreground]",
  generated: "bg-white/5 text-[--muted-foreground]",
  rejected: "bg-red-500/15 text-red-400",
  unsafe: "bg-red-500/15 text-red-400",
  superseded: "bg-white/5 text-[--muted-foreground]/70",
  rolled_back: "bg-red-500/15 text-red-400",
};

function CandidateChip({ c }: { c: Candidate }) {
  return (
    <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-2.5">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLOR[c.survivalStatus] ?? STATUS_COLOR.generated}`}>
          {c.survivalStatus === "champion" && <Crown className="inline w-2.5 h-2.5 -mt-0.5 mr-0.5" />}
          {c.survivalStatus}
        </span>
        <span className="text-[10px] text-[--muted-foreground]">gen {c.generation}</span>
      </div>
      <div className="text-xs text-[--foreground] mt-1 truncate">{c.type}{c.mutationType ? ` · ${c.mutationType}` : ""}</div>
      <div className="flex gap-2 mt-1 text-[10px] text-[--muted-foreground]">
        <span>fitness {c.fitnessScore?.toFixed(2) ?? "—"}</span>
        <span>novelty {c.noveltyScore?.toFixed(2) ?? "—"}</span>
      </div>
    </div>
  );
}

export function EvolutionArchiveView() {
  const [groups, setGroups] = useState<ChampionGroup[]>([]);
  const [archive, setArchive] = useState<Candidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/learning/evolution")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setGroups(data.groups);
        setArchive(data.archive);
      })
      .catch(() => setError("Could not load the evolution archive."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Dna className="w-4 h-4 text-[--primary]" /> Evolution Archive
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Champion vs. challengers per improvable subsystem. Nothing is deleted — failed and superseded
        candidates stay in the archive as training evidence, and structurally novel candidates are
        preserved even when they don&apos;t win on fitness alone.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 border border-red-500/20 rounded-lg p-6 text-center">{error}</div>
      ) : groups.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No championGroup has been proposed yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.championGroup}>
              <div className="text-xs font-medium text-[--foreground] mb-2">{g.championGroup}</div>
              <div className="grid grid-cols-3 gap-2">
                {g.champion && <CandidateChip c={g.champion} />}
                {g.challengers.map((c) => (
                  <CandidateChip key={c.id} c={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {archive.length > 0 && (
        <div className="mt-8">
          <div className="text-xs font-medium text-[--foreground] mb-2">Archive (quality + diversity)</div>
          <div className="grid grid-cols-3 gap-2">
            {archive.slice(0, 12).map((c) => (
              <CandidateChip key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
