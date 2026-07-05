import { cn } from "@/lib/utils";

interface WorkspaceCardProps {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  accent?: string;
}

export function WorkspaceCard({
  title,
  description,
  children,
  className,
  actions,
  accent,
}: WorkspaceCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] text-[--canvas-card-foreground] flex flex-col",
        className
      )}
    >
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-2">
                {accent && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: accent }}
                  />
                )}
                <h3 className="text-sm font-semibold text-[--canvas-card-foreground] leading-tight">
                  {title}
                </h3>
              </div>
            )}
            {description && (
              <p className="text-xs text-[--muted-foreground] mt-0.5">{description}</p>
            )}
          </div>
          {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children && (
        <div className={cn("px-5 pb-5", !title && !actions && "pt-5")}>
          {children}
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export function StatCard({ label, value, sub, color }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] px-5 py-4 flex flex-col gap-1">
      <span className="text-xs text-[--muted-foreground] uppercase tracking-wider">{label}</span>
      <span
        className="text-2xl font-bold leading-none"
        style={{ color: color ?? "var(--canvas-card-foreground)" }}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-[--muted-foreground]">{sub}</span>}
    </div>
  );
}
