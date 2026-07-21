import { FileText } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceCard } from "@/components/workspace/WorkspaceCard";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export default async function FilesPage() {
  const user = await requireUser();
  const documents = await db.document.findMany({
    where: { OR: [{ project: { userId: user.id } }, { workspace: { ownerId: user.id } }] },
    include: { project: { select: { name: true } }, workspace: { select: { name: true, slug: true } } },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });
  return (
    <AppShell>
      <WorkspaceShell>
        <WorkspaceHeader title="Files" description="Documents attached to your projects and workspaces." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {documents.length === 0 ? (
            <WorkspaceCard className="md:col-span-2 xl:col-span-3"><div className="py-12 text-center text-sm text-[--muted-foreground]">No documents yet. Create one from a workspace’s Documents module.</div></WorkspaceCard>
          ) : documents.map((document) => (
            <WorkspaceCard key={document.id}>
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 shrink-0 text-[--primary]" />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">{document.title}</h2>
                  <p className="mt-1 text-xs text-[--muted-foreground]">{document.workspace?.name ?? "Personal"}{document.project ? ` · ${document.project.name}` : ""}</p>
                  <p className="mt-3 text-[10px] uppercase tracking-wide text-[--muted-foreground]">{document.type} · v{document.version} · {document.updatedAt.toLocaleDateString()}</p>
                </div>
              </div>
            </WorkspaceCard>
          ))}
        </div>
      </WorkspaceShell>
    </AppShell>
  );
}
