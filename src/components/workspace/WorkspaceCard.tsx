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
  /** Optional lucide icon rendered in a tinted badge (top-right). */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional trend read-out shown under the value. */
  trend?: string;
  trendTone?: "up" | "down" | "neutral";
}

const TREND_TONE: Record<string, string> = {
  up: "#10b981",
  down: "#ef4444",
  neutral: "var(--muted-foreground)",
};

export function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
  trend,
  trendTone = "neutral",
}: StatCardProps) {
  const accent = color ?? "var(--primary)";
  return (
    <div className="card-hover rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] px-4 py-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-[--muted-foreground] font-medium">{label}</span>
        {Icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <span
        className="text-2xl font-bold leading-none"
        style={{ color: color ?? "var(--canvas-card-foreground)" }}
      >
        {value}
      </span>
      {(sub || trend) && (
        <div className="flex items-center gap-1.5 text-xs">
          {trend && (
            <span
              className="font-medium"
              style={{ color: TREND_TONE[trendTone] }}
            >
              {trend}
            </span>
          )}
          {sub && <span className="text-[--muted-foreground]">{sub}</span>}
        </div>
      )}
    </div>
  );
}
