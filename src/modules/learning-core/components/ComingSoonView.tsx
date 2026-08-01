import { Construction } from "lucide-react";

export function ComingSoonView({ label, owner }: { label: string; owner: "claude" | "codex" | "shared" }) {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-2 flex items-center gap-2">
        <Construction className="w-4 h-4 text-[--muted-foreground]" /> {label}
      </h1>
      <p className="text-sm text-[--muted-foreground]">
        This section ships in a later phase — see{" "}
        <code className="text-[--foreground]">docs/LEARNING_CORE_PLAN.md</code> for the roadmap
        {owner !== "shared" && <> (owned by {owner === "claude" ? "Claude" : "Codex"})</>}.
      </p>
    </div>
  );
}
