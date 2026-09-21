"use client";

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { RevisionPosition, Stage } from "@/lib/control-plane/types";
import { STAGE_LABELS, toneFor } from "./rail-model";

/**
 * Evidence for one stage.
 *
 * Attached beneath the rail it belongs to rather than opened as a modal: the
 * question being asked is "why does that dot say that?", and an overlay that
 * hides the rail answers it while removing the thing being asked about.
 */
export function StageInspector({
  position,
  stage,
  onClose,
}: {
  position: RevisionPosition;
  stage: Stage;
  onClose: () => void;
}) {
  const tone = toneFor(stage.state);

  return (
    <div className="mt-3 border-t border-[color:var(--border)] pt-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-[color:var(--foreground)]">
            {STAGE_LABELS[stage.id]}
          </span>
          <span
            className={cn(
              "text-[11px]",
              tone === "failure"
                ? "text-[color:var(--rail-severed)]"
                : tone === "attention"
                  ? "text-[color:var(--rail-attention)]"
                  : "text-[color:var(--muted-foreground)]",
            )}
          >
            {stage.state.replace(/_/g, " ")}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-[color:var(--muted-foreground)] underline-offset-2 hover:text-[color:var(--foreground)] hover:underline"
        >
          Close
        </button>
      </div>

      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--foreground)]">{stage.detail}</p>

      {stage.missingIntegration ? (
        <p className="mt-1.5 text-[11.5px] text-[color:var(--muted-foreground)]">
          Connect <span className="font-medium text-[color:var(--foreground)]">{stage.missingIntegration}</span> to
          answer this stage. Until then it is reported as unknown rather than assumed.
        </p>
      ) : null}

      {stage.evidence.length ? (
        <dl className="control-plane-figures mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
          {stage.evidence.map((item) => (
            <div key={`${item.label}-${item.value}`} className="contents">
              <dt className="text-[11px] uppercase tracking-[0.07em] text-[color:var(--muted-foreground)]">
                {item.label}
              </dt>
              <dd className="min-w-0 break-words text-[12px] text-[color:var(--foreground)]">
                <span className="font-mono">{item.value}</span>
                <span className="ml-2 text-[11px] text-[color:var(--muted-foreground)]">
                  {item.source}
                  {item.observedAt ? ` · ${relative(item.observedAt)}` : ""}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[11.5px] text-[color:var(--muted-foreground)]">
          No evidence was collected for this stage.
        </p>
      )}

      <p className="mt-3 text-[11px] text-[color:var(--muted-foreground)]">
        Observed {relative(position.observedAt)} · {position.path}
      </p>
    </div>
  );
}

function relative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDistanceToNow(date, { addSuffix: true });
}
