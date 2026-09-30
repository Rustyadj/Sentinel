"use client";

import { Bot, Clapperboard, Code2, Megaphone, Search, Sparkles, FlaskConical, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const AVATARS: Record<string, LucideIcon> = { bot: Bot, clapperboard: Clapperboard, code: Code2, megaphone: Megaphone, search: Search, sparkles: Sparkles, flask: FlaskConical };

export function BotAvatar({ icon, color, size = 36 }: { icon: string; color: string; size?: number }) {
  const Icon = AVATARS[icon] ?? Bot;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-lg" style={{ width: size, height: size, backgroundColor: `${color}26`, color }} aria-hidden>
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.8} />
    </span>
  );
}

const TONES = {
  neutral: "border-[--border] text-[--muted-foreground]",
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  bad: "border-red-500/30 bg-red-500/10 text-red-400",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-400",
} as const;
export type Tone = keyof typeof TONES;

/** Status is always text as well as colour. */
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", TONES[tone], className)}>{children}</span>;
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "active": case "COMPLETED": return "good";
    case "draft": case "QUEUED": return "neutral";
    case "RUNNING": return "info";
    case "WAITING": return "warn";
    default: return "bad";
  }
}

export function Button({ variant = "secondary", busy, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-[--primary] text-[--primary-foreground] hover:opacity-90",
        variant === "secondary" && "border border-[--border] bg-[--card] text-[--foreground] hover:bg-[--accent]",
        variant === "ghost" && "text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground]",
        variant === "danger" && "border border-red-500/40 text-red-400 hover:bg-red-500/10",
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

const fieldClass = "w-full rounded-md border border-[--border] bg-[--background] px-2.5 py-1.5 text-[13px] text-[--foreground] placeholder:text-[--muted-foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-[--foreground]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-[--muted-foreground]">{hint}</span> : null}
    </label>
  );
}
export const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cn(fieldClass, props.className)} />;
export const TextArea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={cn(fieldClass, "min-h-[72px] resize-y leading-5", props.className)} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cn(fieldClass, props.className)} />;

export function Notice({ tone = "bad", children, action }: { tone?: Tone; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]", TONES[tone])}>
      <span className="min-w-0 break-words">{children}</span>
      {action}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-[--border] p-6">
      <p className="text-[14px] font-medium text-[--foreground]">{title}</p>
      {children ? <p className="max-w-[60ch] text-[13px] leading-5 text-[--muted-foreground]">{children}</p> : null}
      {action}
    </div>
  );
}

export const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
