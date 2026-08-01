import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputClass =
  "w-full rounded-md border border-[--sidebar-border] bg-[--background] px-2.5 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/60";
export const buttonClass =
  "rounded-md bg-[--primary] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
export const secondaryButtonClass =
  "rounded-md border border-[--sidebar-border] px-2.5 py-1.5 text-xs text-[--muted-foreground] hover:border-[--primary]/40 hover:text-[--foreground] disabled:opacity-50";

export function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="mb-1 flex items-center gap-2 text-lg font-semibold text-[--foreground]">
        {icon} {title}
      </h1>
      <p className="max-w-3xl text-sm text-[--muted-foreground]">{description}</p>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">{message}</div> : null;
}

export function LevelBadge({ level }: { level: number }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        level === 3
          ? "border-red-400/30 bg-red-400/10 text-red-300"
          : level === 2
            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
      )}
    >
      Level {level}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] capitalize text-[--muted-foreground]">{status}</span>;
}

export async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? `Request failed (${response.status})`;
}
