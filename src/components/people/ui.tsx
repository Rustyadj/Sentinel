"use client";

import { cn } from "@/lib/utils";

// Small form pieces shared by the People, Roundtable and Projects screens.

export const fieldClass =
  "h-10 w-full rounded-(--radius-md) border border-(--border) bg-(--background) px-3 text-[14px] text-(--foreground) placeholder:text-(--text-faint) transition-colors hover:border-(--border-strong) focus-visible:border-(--ring) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)/40 disabled:opacity-60";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-(--foreground)">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] leading-snug text-(--muted-foreground)">{hint}</span> : null}
    </label>
  );
}

export function PrimaryButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-(--primary) px-5 text-[13.5px] font-semibold text-(--primary-foreground) transition-colors hover:bg-(--primary-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background) disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}

export function QuietButton({ className, danger, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-full border border-(--border) px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "text-(--destructive) hover:border-(--destructive)" : "text-(--foreground) hover:border-(--border-strong) hover:bg-(--muted)",
        className,
      )}
    />
  );
}

/** One of a small set of options, shown with what it grants so the choice is informed. */
export function ChoiceCard({ name, value, checked, onChange, title, detail }: {
  name: string; value: string; checked: boolean; onChange: (value: string) => void; title: string; detail: string;
}) {
  return (
    <label className={cn(
      "flex cursor-pointer gap-3 rounded-(--radius-md) border px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-(--ring)",
      checked ? "border-(--primary) bg-(--primary-wash)" : "border-(--border) hover:border-(--border-strong)",
    )}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
      <span aria-hidden className={cn("mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-(--primary)" : "border-(--border-strong)")}>
        {checked ? <span className="h-2 w-2 rounded-full bg-(--primary)" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-(--foreground)">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-(--muted-foreground)">{detail}</span>
      </span>
    </label>
  );
}

export function Notice({ tone = "error", children }: { tone?: "error" | "info"; children: React.ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn(
      "rounded-(--radius-md) border px-3.5 py-2.5 text-[13px] leading-snug",
      tone === "error" ? "border-(--destructive)/50 bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-(--destructive)" : "border-(--border) bg-(--panel) text-(--muted-foreground)",
    )}>
      {children}
    </p>
  );
}

export function Initial({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--accent) text-[13px] font-semibold text-(--foreground)", className)}>
      {(name ?? "?").trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (value: string | Date) => DATE.format(new Date(value));
