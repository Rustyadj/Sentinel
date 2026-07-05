import { notFound } from "next/navigation";
import { WORKSPACES } from "@/lib/workspaces";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceCard } from "@/components/workspace/WorkspaceCard";

const WORKSPACE_COLOR: Record<string, string> = Object.fromEntries(
  WORKSPACES.map((workspace) => [workspace.id, workspace.color])
);

export default async function WorkspaceModulePlaceholder({
  params,
}: {
  params: Promise<{ workspace: string; slug: string[] }>;
}) {
  const { workspace, slug } = await params;
  const definition = WORKSPACES.find((entry) => entry.id === workspace);

  if (!definition) {
    notFound();
  }

  const sectionTitle = slug
    .join(" / ")
    .split("/")
    .map((segment) =>
      segment
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    )
    .join(" / ");

  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title={sectionTitle}
        description={`${definition.label} module surface is reserved in the new workspace shell.`}
        accent={WORKSPACE_COLOR[definition.id]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WorkspaceCard
          title="Module Surface"
          description="The Fable 5 workspace architecture is active. This route now resolves inside the new shell instead of falling through to a 404."
          accent={WORKSPACE_COLOR[definition.id]}
        >
          <div className="space-y-3 text-sm text-[--muted-foreground]">
            <p>
              Workspace: <span className="text-[--canvas-card-foreground]">{definition.label}</span>
            </p>
            <p>
              Route: <span className="font-mono text-[--canvas-card-foreground]">/{["workspaces", workspace, ...slug].join("/")}</span>
            </p>
            <p>
              Navigation is now consistent with the new rail and workspace model. This sub-route can be upgraded into a full module surface without changing the shell.
            </p>
          </div>
        </WorkspaceCard>

        <WorkspaceCard
          title="Next Step"
          description="Suggested follow-on implementation"
        >
          <div className="space-y-2 text-xs text-[--muted-foreground]">
            <p>Promote this placeholder into a dedicated module page when the backing workflow is ready.</p>
            <p>The navigation and route contract are already in place.</p>
          </div>
        </WorkspaceCard>
      </div>
    </WorkspaceShell>
  );
}
