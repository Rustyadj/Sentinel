import { cn } from "@/lib/utils";

interface SentinelLogoProps {
  markOnly?: boolean;
  wordmarkOnly?: boolean;
  className?: string;
}

/**
 * The mark is the product's one idea: a light, and the beam it casts on what
 * it is watching. Drawn, not an image, so it takes its colours from the tokens.
 */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("h-full w-auto shrink-0", className)}>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M11 20.5 27 7.5v13.5Z" fill="var(--on-fill)" opacity="0.22" />
      <path d="M11 20.5 27 7.5" stroke="var(--on-fill)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="11" cy="20.5" r="4.6" fill="var(--on-fill)" />
    </svg>
  );
}

export function SentinelLogo({ markOnly = false, wordmarkOnly = false, className }: SentinelLogoProps) {
  return (
    <span role="img" aria-label="Sentinel OS" className={cn("inline-flex h-[30px] shrink-0 items-center gap-2.5", className)}>
      {wordmarkOnly ? null : <Mark />}
      {markOnly ? null : <span className="font-display text-[19px] font-semibold leading-none tracking-tight text-(--foreground)">Sentinel</span>}
    </span>
  );
}
