"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { ControlPlaneData, RepositoryProblem } from "@/lib/control-plane/service";
import type { DriftStatus, RevisionPosition, StageId } from "@/lib/control-plane/types";
import { ReleaseRail } from "./ReleaseRail";
import { StageInspector } from "./StageInspector";

/**
 * The control plane.
 *
 * Deliberately not a grid of cards: one rail per repository, stacked, sharing
 * a single set of columns so an operator reads down a column to compare
 * repositories and across a row to follow one change. Everything on screen is
 * either an observation or a statement that something could not be observed.
 */
export function ControlPlane({ data }: { data: ControlPlaneData }) {
  const [selected, setSelected] = useState<{ key: string; stage: StageId } | null>(null);

  const attention = useMemo(
    () => data.positions.filter((position) => needsAttention(position.drift.status)),
    [data.positions],
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6">
      <OperationsStrip data={data} attentionCount={attention.length} />

      {data.positions.length === 0 && data.problems.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6">
          {data.positions.map((position) => {
            const key = `${position.repositoryId ?? position.path}:${position.environment}`;
            const openStage = selected?.key === key ? selected.stage : null;
            return (
              <RepositoryRow
                key={key}
                position={position}
                openStage={openStage}
                onSelectStage={(stage) =>
                  setSelected((current) =>
                    current?.key === key && current.stage === stage ? null : { key, stage },
                  )
                }
              />
            );
          })}
        </div>
      )}

      {data.problems.length ? <Problems problems={data.problems} /> : null}

      <p className="control-plane-figures mt-8 text-[11px] text-[color:var(--muted-foreground)]">
        Observed {relative(data.generatedAt)}. Nothing on this page is cached, inferred or filled in — a stage that
        could not be established says so.
      </p>
    </div>
  );
}

function RepositoryRow({
  position,
  openStage,
  onSelectStage,
}: {
  position: RevisionPosition;
  openStage: StageId | null;
  onSelectStage: (stage: StageId) => void;
}) {
  const stage = openStage ? position.stages.find((candidate) => candidate.id === openStage) ?? null : null;

  return (
    <section className="border-t border-[color:var(--border)] py-5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[14px] font-medium text-[color:var(--foreground)]">{position.name}</h2>
          <span className="control-plane-figures font-mono text-[11.5px] text-[color:var(--muted-foreground)]">
            {position.branch ?? "detached HEAD"}
          </span>
          <span className="control-plane-figures font-mono text-[11.5px] text-[color:var(--muted-foreground)]">
            {position.head.shortSha}
          </span>
          <span className="truncate text-[11.5px] text-[color:var(--muted-foreground)]">{position.head.subject}</span>
        </div>
        <DriftBadge position={position} />
      </div>

      <div className="mt-2.5">
        <ReleaseRail position={position} selectedStage={openStage} onSelectStage={onSelectStage} />
      </div>

      {stage ? <StageInspector position={position} stage={stage} onClose={() => onSelectStage(stage.id)} /> : null}
    </section>
  );
}

function needsAttention(status: DriftStatus): boolean {
  return status === "behind" || status === "ahead" || status === "diverged";
}

/**
 * Drift is stated in words, not encoded in a colour. "4 commits behind main"
 * is actionable; an amber dot is a puzzle.
 */
function DriftBadge({ position }: { position: RevisionPosition }) {
  const { drift, environment } = position;
  const tone = needsAttention(drift.status) ? "attention" : drift.status === "unknown" ? "unknown" : "neutral";

  return (
    <div className="control-plane-figures flex shrink-0 items-baseline gap-2 text-[11.5px]">
      <span className="uppercase tracking-[0.07em] text-[color:var(--muted-foreground)]">{environment}</span>
      <span
        className={cn(
          tone === "attention"
            ? "text-[color:var(--rail-attention)]"
            : tone === "unknown"
              ? "text-[color:var(--muted-foreground)]"
              : "text-[color:var(--foreground)]",
        )}
      >
        {drift.detail}
      </span>
      {drift.stale ? (
        <span
          className="text-[color:var(--muted-foreground)]"
          title={
            drift.defaultBranchAsOf
              ? `Remote refs last fetched ${relative(drift.defaultBranchAsOf)}. Sentinel never fetches on read.`
              : "This checkout has never fetched from its remote."
          }
        >
          · refs {drift.defaultBranchAsOf ? relative(drift.defaultBranchAsOf) : "never fetched"}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Instrumentation, not navigation. Each figure is a count of something
 * observed; a figure that could not be observed is shown as a dash rather than
 * as zero, because zero is a measurement.
 */
function OperationsStrip({ data, attentionCount }: { data: ControlPlaneData; attentionCount: number }) {
  const live = data.positions.filter((position) => position.drift.status === "match").length;
  const unknown = data.positions.filter((position) => position.drift.status === "unknown").length;
  const dirty = data.positions.filter(
    (position) => position.stages.find((stage) => stage.id === "working")?.state === "reached",
  ).length;
  const blocked = data.positions.filter((position) =>
    position.stages.some((stage) => stage.state === "blocked"),
  ).length;

  return (
    <header>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-[15px] font-medium tracking-tight text-[color:var(--foreground)]">Control plane</h1>
        <span className="control-plane-figures text-[11px] text-[color:var(--muted-foreground)]">
          {data.positions.length} rail{data.positions.length === 1 ? "" : "s"}
        </span>
      </div>

      <dl className="control-plane-figures mt-3 flex flex-wrap gap-x-8 gap-y-2 border-y border-[color:var(--border)] py-2.5">
        <Figure label="Matching main" value={live} />
        <Figure label="Drifted" value={attentionCount} tone={attentionCount ? "attention" : "neutral"} />
        <Figure label="Uncommitted" value={dirty} />
        <Figure label="Failing" value={blocked} tone={blocked ? "failure" : "neutral"} />
        <Figure label="Unplaceable" value={unknown} tone="unknown" />
      </dl>
    </header>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | null;
  tone?: "neutral" | "attention" | "failure" | "unknown";
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[10.5px] uppercase tracking-[0.09em] text-[color:var(--muted-foreground)]">{label}</dt>
      <dd
        className={cn(
          "text-[13px] tabular-nums",
          tone === "attention"
            ? "text-[color:var(--rail-attention)]"
            : tone === "failure"
              ? "text-[color:var(--rail-severed)]"
              : tone === "unknown"
                ? "text-[color:var(--muted-foreground)]"
                : "text-[color:var(--foreground)]",
        )}
      >
        {value === null ? "—" : value}
      </dd>
    </div>
  );
}

function Problems({ problems }: { problems: RepositoryProblem[] }) {
  return (
    <section className="mt-8 border-t border-[color:var(--border)] pt-4">
      <h2 className="text-[11px] uppercase tracking-[0.09em] text-[color:var(--muted-foreground)]">
        Registered but not observable
      </h2>
      <ul className="mt-2 space-y-1.5">
        {problems.map((problem) => (
          <li key={problem.repositoryId} className="text-[12px] text-[color:var(--foreground)]">
            <span className="font-medium">{problem.name}</span>
            <span className="text-[color:var(--muted-foreground)]"> — {problem.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 border-t border-[color:var(--border)] pt-6">
      <p className="text-[13px] text-[color:var(--foreground)]">No repositories are registered yet.</p>
      <p className="mt-1.5 max-w-prose text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
        The control plane observes checkouts that have been registered with a local path and, optionally, the container
        and endpoints that serve them. It does not scan the filesystem on its own: a rail should only ever appear for a
        repository someone deliberately put there.
      </p>
    </div>
  );
}

function relative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDistanceToNow(date, { addSuffix: true });
}
