"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * Compact toggle for boolean settings rows. Sized for dense operational
 * surfaces (graph controls, panel settings) rather than forms — pair it with
 * a `<label>` or an `aria-label`, never leave it unlabelled.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[15px] w-[27px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring] focus-visible:ring-offset-1 focus-visible:ring-offset-[--background]",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:bg-violet-500/85 data-[state=unchecked]:bg-white/[0.13]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-[11px] w-[11px] rounded-full bg-white shadow-sm transition-transform",
        "data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-[2px]",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
