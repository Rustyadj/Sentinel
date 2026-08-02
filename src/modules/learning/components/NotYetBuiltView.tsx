import { Construction } from "lucide-react";

export function NotYetBuiltView({ label }: { label: string }) {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-2 flex items-center gap-2">
        <Construction className="w-4 h-4 text-[--muted-foreground]" /> {label}
      </h1>
      <p className="text-sm text-[--muted-foreground]">
        Not built yet — see the phase plan in{" "}
        <code className="text-[--foreground]">docs/LEARNING_CORE_ON_NEURAL_ENGINE.md</code>. Only
        Overview ships in this pass.
      </p>
    </div>
  );
}
