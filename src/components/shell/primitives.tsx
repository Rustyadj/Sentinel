"use client";

import { cn } from "@/lib/utils";

export type EntityType =
  | "agent" | "project" | "workspace" | "knowledge" | "memory"
  | "tool" | "source" | "conversation" | "external";

/** Entity colour comes from one token per type — never a literal in a component. */
export const ENTITY_TOKEN: Record<EntityType, string> = {
  agent: "var(--entity-agent)",
  project: "var(--entity-project)",
  workspace: "var(--entity-workspace)",
  knowledge: "var(--entity-knowledge)",
  memory: "var(--entity-memory)",
  tool: "var(--entity-tool)",
  source: "var(--entity-source)",
  conversation: "var(--entity-conversation)",
  external: "var(--entity-external)",
};

export type Status = "online" | "busy" | "idle" | "offline" | "error";

const STATUS_TOKEN: Record<Status, string> = {
  online: "var(--status-online)",
  busy: "var(--status-busy)",
  idle: "var(--status-idle)",
  offline: "var(--status-idle)",
  error: "var(--status-error)",
};

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      role="img"
      aria-label={status}
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
      style={{ background: STATUS_TOKEN[status] }}
    />
  );
}

/** A reference to a real Sentinel object. Colour encodes the entity type. */
export function EntityChip({ type, label, onClick, className }: {
  type: EntityType;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ENTITY_TOKEN[type] }} />
      <span className="truncate">{label}</span>
    </>
  );
  const base = "inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-[--muted-foreground]";
  if (!onClick) return <span className={cn(base, className)}>{content}</span>;
  return (
    <button type="button" onClick={onClick} className={cn(base, "transition-colors hover:bg-[--muted] hover:text-[--foreground]", className)}>
      {content}
    </button>
  );
}

/** Quiet icon affordance — no border, no card, visible focus ring. */
export function IconButton({ label, onClick, children, className, active }: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-[--muted-foreground] transition-colors",
        "hover:bg-[--muted] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]",
        active && "bg-[--muted] text-[--foreground]",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Consistent, honest empty state. Never a placeholder for missing data. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-[15px] text-[--foreground]">{title}</p>
      {hint ? <p className="max-w-md text-[13px] leading-relaxed text-[--muted-foreground]">{hint}</p> : null}
      {action}
    </div>
  );
}
