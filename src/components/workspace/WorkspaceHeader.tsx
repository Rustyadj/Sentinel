import { cn } from "@/lib/utils";

interface WorkspaceHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  accent?: string;
  className?: string;
}

export function WorkspaceHeader({
  title,
  description,
  actions,
  accent,
  className,
}: WorkspaceHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 mb-6", className)}>
      <div className="flex items-center gap-3 min-w-0">
        {accent && (
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
          />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[--canvas-foreground] leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[--canvas-muted] mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
