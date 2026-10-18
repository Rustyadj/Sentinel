import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-(--border) bg-(--panel) px-3 py-1 text-sm text-(--foreground) transition-colors hover:border-(--border-strong) file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-(--text-faint) focus-visible:border-(--primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--primary)/30 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
