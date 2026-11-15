import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-(--primary) text-(--primary-foreground)",
        secondary:
          "border-transparent bg-(--muted) text-(--muted-foreground)",
        destructive:
          "border-transparent bg-(--destructive)/15 text-(--destructive)",
        outline: "border-(--border) text-(--foreground)",
        success:
          "border-transparent bg-[color-mix(in_srgb,var(--status-online)_14%,transparent)] text-(--status-online)",
        warning:
          "border-transparent bg-[color-mix(in_srgb,var(--status-busy)_14%,transparent)] text-(--status-busy)",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
