import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  children: React.ReactNode;
  className?: string;
  /** Remove default padding — for full-bleed layouts like Studio */
  noPadding?: boolean;
}

export function WorkspaceShell({ children, className, noPadding }: WorkspaceShellProps) {
  return (
    <div
      className={cn(
        "min-h-full bg-[--canvas] text-[--canvas-foreground]",
        !noPadding && "p-6",
        className
      )}
    >
      {children}
    </div>
  );
}
