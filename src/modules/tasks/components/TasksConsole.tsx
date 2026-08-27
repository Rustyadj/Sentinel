import { GitBranch, FolderGit2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { cn } from "@/lib/utils";

interface AgentRef {
  id: string;
  name: string;
  color: string;
}

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  branch: string | null;
  worktreePath: string | null;
  dependsOnTaskIds: string[];
  updatedAt: Date;
  agent: AgentRef | null;
  reviewerAgent: AgentRef | null;
  workspace: { id: string; name: string; color: string } | null;
  project: { id: string; name: string } | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  completed: "success",
  running: "default",
  claimed: "default",
  in_progress: "default",
  waiting_review: "warning",
  changes_requested: "warning",
  approval_required: "warning",
  blocked: "destructive",
  failed: "destructive",
  cancelled: "outline",
  backlog: "secondary",
  queued: "secondary",
  planned: "secondary",
};

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function AgentPill({ agent, label }: { agent: AgentRef | null; label: string }) {
  if (!agent) return <span className="text-[--muted-foreground]">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} aria-hidden />
      <span title={label}>{agent.name}</span>
    </span>
  );
}

export function TasksConsole({ tasks }: { tasks: TaskRow[] }) {
  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Tasks"
        description="Every executable unit of agent work — owner, repository, branch, and status."
        showBack={false}
      />

      <div className="overflow-x-auto rounded-lg border border-[--canvas-card-border]">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead className="sticky top-0 bg-[--canvas-card]">
            <tr className="border-b border-[--canvas-card-border] text-left text-[11px] uppercase tracking-wide text-[--muted-foreground]">
              <th className="px-3 py-2.5 font-medium">Task</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Priority</th>
              <th className="px-3 py-2.5 font-medium">Agent</th>
              <th className="px-3 py-2.5 font-medium">Workspace</th>
              <th className="px-3 py-2.5 font-medium">Branch / Worktree</th>
              <th className="px-3 py-2.5 font-medium">Depends on</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className="border-b border-[--canvas-card-border] last:border-0 hover:bg-[--canvas-card]/60"
              >
                <td className="max-w-[280px] px-3 py-2.5">
                  <div className="truncate font-medium text-[--canvas-foreground]">{task.title}</div>
                  {task.project ? (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[--muted-foreground]">
                      <FolderGit2 className="h-3 w-3" /> {task.project.name}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={STATUS_VARIANT[task.status] ?? "secondary"} className="capitalize">
                    {statusLabel(task.status)}
                  </Badge>
                </td>
                <td className={cn("px-3 py-2.5 capitalize", task.priority === "high" || task.priority === "urgent" ? "text-[--destructive]" : "text-[--muted-foreground]")}>
                  {task.priority}
                </td>
                <td className="px-3 py-2.5">
                  <div className="space-y-0.5">
                    <AgentPill agent={task.agent} label="Owner" />
                    {task.reviewerAgent ? (
                      <div className="text-[11px] text-[--muted-foreground]">
                        Reviewer: <AgentPill agent={task.reviewerAgent} label="Reviewer" />
                      </div>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[--muted-foreground]">
                  {task.workspace ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: task.workspace.color }} aria-hidden />
                      {task.workspace.name}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-[--muted-foreground]">
                  {task.branch ? (
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate">{task.branch}</span>
                    </div>
                  ) : (
                    "—"
                  )}
                  {task.worktreePath ? <div className="mt-0.5 truncate opacity-70">{task.worktreePath}</div> : null}
                </td>
                <td className="px-3 py-2.5 text-[--muted-foreground]">
                  {task.dependsOnTaskIds.length > 0 ? `${task.dependsOnTaskIds.length} task${task.dependsOnTaskIds.length === 1 ? "" : "s"}` : "—"}
                </td>
              </tr>
            ))}
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[--muted-foreground]">
                  No tasks yet — tasks created by agents or from a workspace will show up here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </WorkspaceShell>
  );
}
