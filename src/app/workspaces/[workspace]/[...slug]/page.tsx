import { notFound } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  FolderKanban,
  KeyRound,
  ShieldCheck,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  getWorkspaceBySlug,
  listApprovals,
  listMeetings,
  listPermissions,
  listProjects,
  listRoles,
  listTeams,
} from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import {
  assignRoleAction,
  createApprovalAction,
  createDocumentAction,
  createMeetingAction,
  createPermissionAction,
  createProjectAction,
  createRoleAction,
  createTaskAction,
  createTeamAction,
  decideApprovalAction,
  moveTaskAction,
  revokeAssignmentAction,
  updateTeamMembersAction,
} from "@/app/workspaces/actions";
import { WorkspaceCard, StatCard } from "@/components/workspace/WorkspaceCard";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

const field =
  "mt-1 h-9 w-full rounded-md border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]";
const button =
  "inline-flex h-9 items-center justify-center rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-foreground] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]";
const secondaryButton =
  "inline-flex h-8 items-center justify-center rounded-md border border-[--border] bg-[--muted] px-3 text-xs text-[--foreground] hover:bg-[--accent]";

function Scope({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  return (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">{children}</div>;
}

function titleCase(value: string) {
  return value.split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

export default async function WorkspaceModulePage({
  params,
}: {
  params: Promise<{ workspace: string; slug: string[] }>;
}) {
  const { workspace: workspaceSlug, slug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();
  await requireWorkspacePermission(workspace.id, "workspace.read");

  const section = slug[0] ?? "overview";
  const [projects, teams] = await Promise.all([
    listProjects({ workspaceId: workspace.id }),
    listTeams(workspace.id),
  ]);

  if (section === "teams") {
    const [users, agents] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { email: "asc" } }),
      db.agent.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Teams" description="Create teams and assign human or agent members." accent={workspace.color} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="space-y-3">
            {teams.length === 0 ? <Empty>No teams have been created.</Empty> : teams.map((team) => (
              <WorkspaceCard key={team.id} title={team.name} description={team.description ?? "No description"} actions={<span className="text-[11px] text-[--muted-foreground]">{team._count.projects} projects · {team._count.tasks} tasks</span>}>
                <div className="mb-4 grid gap-2 text-xs text-[--muted-foreground] sm:grid-cols-2">
                  <span>{team.memberUserIds.length} user members</span>
                  <span>{team.memberAgentIds.length} agent members</span>
                </div>
                <form action={updateTeamMembersAction} className="grid gap-3 sm:grid-cols-2">
                  <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
                  <input type="hidden" name="teamId" value={team.id} />
                  <label className="text-xs text-[--muted-foreground]">User IDs<input name="memberUserIds" defaultValue={team.memberUserIds.join(", ")} className={field} /></label>
                  <label className="text-xs text-[--muted-foreground]">Agent IDs<input name="memberAgentIds" defaultValue={team.memberAgentIds.join(", ")} className={field} /></label>
                  <button className={`${secondaryButton} sm:col-span-2`}>Update members</button>
                </form>
              </WorkspaceCard>
            ))}
          </div>
          <div className="space-y-4">
            <WorkspaceCard title="Create team">
              <form action={createTeamAction} className="space-y-3">
                <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
                <label className="block text-xs text-[--muted-foreground]">Name<input required name="name" className={field} /></label>
                <label className="block text-xs text-[--muted-foreground]">Description<input name="description" className={field} /></label>
                <label className="block text-xs text-[--muted-foreground]">User IDs<input name="memberUserIds" placeholder="comma-separated IDs" className={field} /></label>
                <label className="block text-xs text-[--muted-foreground]">Agent IDs<input name="memberAgentIds" placeholder="comma-separated IDs" className={field} /></label>
                <button className={`${button} w-full`}>Create team</button>
              </form>
            </WorkspaceCard>
            <WorkspaceCard title="Assignable identities" description="Use these IDs in team membership fields">
              <div className="max-h-52 space-y-2 overflow-auto text-xs">
                {users.map((user) => <div key={user.id}><span className="text-[--foreground]">{user.name ?? user.email}</span><code className="ml-2 text-[10px] text-[--muted-foreground]">{user.id}</code></div>)}
                {agents.map((agent) => <div key={agent.id}><span className="text-[--foreground]">{agent.name}</span><code className="ml-2 text-[10px] text-[--muted-foreground]">{agent.id}</code></div>)}
              </div>
            </WorkspaceCard>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  if (section === "board") {
    const tasks = await db.task.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ position: "asc" }, { createdAt: "desc" }] });
    const columns = ["backlog", "in_progress", "review", "done"] as const;
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Board" description="Workspace tasks persisted in Postgres." accent={workspace.color} />
        <WorkspaceCard title="Add task">
          <form action={createTaskAction} className="grid gap-3 md:grid-cols-6">
            <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
            <label className="text-xs text-[--muted-foreground] md:col-span-2">Title<input required name="title" className={field} /></label>
            <label className="text-xs text-[--muted-foreground]">Project<select name="projectId" className={field}><option value="">None</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="text-xs text-[--muted-foreground]">Team<select name="teamId" className={field}><option value="">None</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label className="text-xs text-[--muted-foreground]">Priority<select name="priority" className={field}><option>low</option><option defaultValue="medium">medium</option><option>high</option><option>critical</option></select></label>
            <button className={`${button} self-end`}>Add task</button>
          </form>
        </WorkspaceCard>
        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          {columns.map((column) => {
            const items = tasks.filter((task) => task.status === column);
            return (
              <WorkspaceCard key={column} title={titleCase(column)} actions={<span className="text-xs text-[--muted-foreground]">{items.length}</span>}>
                <div className="space-y-2">
                  {items.length === 0 ? <p className="py-6 text-center text-xs text-[--muted-foreground]">No tasks</p> : items.map((task) => (
                    <div key={task.id} className="rounded-lg border border-[--border] bg-[--background]/50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium">{task.title}</span>
                        <span className="text-[9px] uppercase text-[--muted-foreground]">{task.priority}</span>
                      </div>
                      <form action={moveTaskAction} className="mt-3 flex gap-2">
                        <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
                        <input type="hidden" name="taskId" value={task.id} />
                        <select name="status" defaultValue={task.status} aria-label={`Move ${task.title}`} className="h-7 min-w-0 flex-1 rounded border border-[--border] bg-[--muted] px-2 text-[10px]">{columns.map((status) => <option key={status}>{status}</option>)}</select>
                        <button className={secondaryButton}>Move</button>
                      </form>
                    </div>
                  ))}
                </div>
              </WorkspaceCard>
            );
          })}
        </div>
      </WorkspaceShell>
    );
  }

  if (section === "documents") {
    const documents = await db.document.findMany({ where: { workspaceId: workspace.id }, include: { project: { select: { name: true } } }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] });
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Documents" description="Project files and workspace documents." accent={workspace.color} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="grid gap-3 md:grid-cols-2">
            {documents.length === 0 ? <div className="md:col-span-2"><Empty>No documents have been created.</Empty></div> : documents.map((document) => (
              <WorkspaceCard key={document.id}>
                <div className="flex gap-3"><FileText className="h-4 w-4 text-[--primary]" /><div><h2 className="text-sm font-medium">{document.title}</h2><p className="mt-1 text-xs text-[--muted-foreground]">{document.project?.name ?? "Workspace"} · {document.type} · v{document.version}</p><p className="mt-3 line-clamp-3 whitespace-pre-wrap text-xs text-[--muted-foreground]">{document.content || "Empty document"}</p></div></div>
              </WorkspaceCard>
            ))}
          </div>
          <WorkspaceCard title="New document">
            <form action={createDocumentAction} className="space-y-3">
              <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
              <label className="block text-xs text-[--muted-foreground]">Title<input required name="title" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Project<select name="projectId" className={field}><option value="">Workspace</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="block text-xs text-[--muted-foreground]">Type<select name="type" className={field}><option>markdown</option><option>text</option><option>link</option></select></label>
              <label className="block text-xs text-[--muted-foreground]">Content<textarea name="content" rows={5} className={`${field} h-auto py-2`} /></label>
              <button className={`${button} w-full`}>Create document</button>
            </form>
          </WorkspaceCard>
        </div>
      </WorkspaceShell>
    );
  }

  if (section === "meetings") {
    const meetings = await listMeetings(workspace.id);
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Meetings" description="Schedule project and workspace meetings." accent={workspace.color} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="space-y-3">
            {meetings.length === 0 ? <Empty>No meetings are scheduled.</Empty> : meetings.map((meeting) => (
              <WorkspaceCard key={meeting.id}>
                <div className="flex gap-3"><CalendarClock className="h-4 w-4 text-[--primary]" /><div><h2 className="text-sm font-medium">{meeting.title}</h2><p className="mt-1 text-xs text-[--muted-foreground]">{meeting.startsAt.toLocaleString()} – {meeting.endsAt.toLocaleTimeString()} · {meeting.project?.name ?? "Workspace"}</p><p className="mt-2 text-xs text-[--muted-foreground]">{meeting.agenda ?? "No agenda"}</p></div></div>
              </WorkspaceCard>
            ))}
          </div>
          <WorkspaceCard title="Schedule meeting">
            <form action={createMeetingAction} className="space-y-3">
              <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
              <label className="block text-xs text-[--muted-foreground]">Title<input required name="title" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Project<select name="projectId" className={field}><option value="">Workspace</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="block text-xs text-[--muted-foreground]">Starts<input required type="datetime-local" name="startsAt" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Ends<input required type="datetime-local" name="endsAt" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Agenda<input name="agenda" className={field} /></label>
              <button className={`${button} w-full`}>Schedule</button>
            </form>
          </WorkspaceCard>
        </div>
      </WorkspaceShell>
    );
  }

  if (section === "permissions") {
    const [roles, permissions, users, agents] = await Promise.all([
      listRoles(workspace.id),
      listPermissions(workspace.id),
      db.user.findMany({ select: { id: true, name: true, email: true } }),
      db.agent.findMany({ select: { id: true, name: true } }),
    ]);
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Permissions" description="Request-time RBAC for users, teams, and agents." accent={workspace.color} />
        <div className="grid gap-4 xl:grid-cols-3">
          <WorkspaceCard title="Permissions" description="Atomic resource actions">
            <div className="mb-4 space-y-2">{permissions.map((permission) => <div key={permission.id} className="rounded border border-[--border] p-2"><code className="text-xs text-[--primary]">{permission.key}</code><p className="text-[10px] text-[--muted-foreground]">{permission.resource}:{permission.action}</p></div>)}</div>
            <form action={createPermissionAction} className="space-y-2">
              <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
              <label className="block text-xs text-[--muted-foreground]">Key<input required name="key" placeholder="project.create" className={field} /></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-xs text-[--muted-foreground]">Resource<input required name="resource" className={field} /></label><label className="text-xs text-[--muted-foreground]">Action<input required name="permissionAction" className={field} /></label></div>
              <button className={`${secondaryButton} w-full`}>Add permission</button>
            </form>
          </WorkspaceCard>
          <WorkspaceCard title="Roles" description="Permission bundles">
            <div className="mb-4 space-y-2">{roles.map((role) => <div key={role.id} className="rounded border border-[--border] p-2"><p className="text-xs font-medium">{role.name}</p><p className="mt-1 text-[10px] text-[--muted-foreground]">{role.permissions.map((permission) => permission.key).join(", ") || "No permissions"} · {role.assignments.length} assignments</p></div>)}</div>
            <form action={createRoleAction} className="space-y-2">
              <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
              <label className="block text-xs text-[--muted-foreground]">Name<input required name="name" className={field} /></label>
              <div className="max-h-32 space-y-1 overflow-auto">{permissions.map((permission) => <label key={permission.id} className="flex gap-2 text-xs text-[--muted-foreground]"><input type="checkbox" name="permissionIds" value={permission.id} />{permission.key}</label>)}</div>
              <button className={`${secondaryButton} w-full`}>Create role</button>
            </form>
          </WorkspaceCard>
          <WorkspaceCard title="Assignments" description="Bind one role to one subject, permanently or as a time-boxed delegation">
            <form action={assignRoleAction} className="space-y-3">
              <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
              <label className="block text-xs text-[--muted-foreground]">Role<select required name="roleId" className={field}><option value="">Select role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
              <label className="block text-xs text-[--muted-foreground]">Subject type<select name="subjectType" className={field}><option value="user">User</option><option value="team">Team</option><option value="agent">Agent</option></select></label>
              <label className="block text-xs text-[--muted-foreground]">Subject ID<input required name="subjectId" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Expires (optional — leave blank for a permanent grant)<input type="datetime-local" name="expiresAt" className={field} /></label>
              <button className={`${button} w-full`}>Assign role</button>
            </form>
            <div className="mt-5 max-h-52 space-y-1 overflow-auto text-[10px] text-[--muted-foreground]">
              {[...users.map((item) => ({ id: item.id, name: item.name ?? item.email, type: "user" })), ...teams.map((item) => ({ id: item.id, name: item.name, type: "team" })), ...agents.map((item) => ({ id: item.id, name: item.name, type: "agent" }))].map((item) => <p key={`${item.type}-${item.id}`}><span className="text-[--foreground]">{item.type}: {item.name}</span> · {item.id}</p>)}
            </div>
            <div className="mt-5 space-y-2">
              <p className="text-xs font-medium text-[--foreground]">Active assignments</p>
              {roles.flatMap((role) => role.assignments.map((assignment) => ({ role, assignment }))).length === 0 ? (
                <p className="text-[10px] text-[--muted-foreground]">No assignments yet.</p>
              ) : roles.flatMap((role) => role.assignments.map((assignment) => ({ role, assignment }))).map(({ role, assignment }) => {
                const subject = assignment.user?.name ?? assignment.user?.email ?? assignment.agent?.name ?? assignment.team?.name ?? "Unknown";
                const expired = assignment.expiresAt ? new Date(assignment.expiresAt) <= new Date() : false;
                return (
                  <div key={assignment.id} className="flex items-center justify-between rounded border border-[--border] p-2 text-[10px]">
                    <span>
                      <span className="text-[--foreground]">{role.name}</span> → {subject}
                      {assignment.expiresAt ? ` · ${expired ? "expired" : "expires"} ${new Date(assignment.expiresAt).toLocaleString()}` : " · permanent"}
                    </span>
                    <form action={revokeAssignmentAction}>
                      <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
                      <input type="hidden" name="assignmentId" value={assignment.id} />
                      <button className="text-[--destructive] hover:underline">Revoke</button>
                    </form>
                  </div>
                );
              })}
            </div>
          </WorkspaceCard>
        </div>
      </WorkspaceShell>
    );
  }

  if (section === "approvals") {
    const approvals = await listApprovals(workspace.id);
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Approvals" description="Audited pending → approved/rejected workflow." accent={workspace.color} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="space-y-3">
            {approvals.length === 0 ? <Empty>No approval requests.</Empty> : approvals.map((approval) => (
              <WorkspaceCard key={approval.id} title={approval.title} description={approval.description ?? approval.type} actions={<span className="rounded-full bg-[--muted] px-2 py-1 text-[10px] uppercase text-[--muted-foreground]">{approval.status}</span>}>
                <p className="text-xs text-[--muted-foreground]">Requested by {approval.requesterUser?.name ?? approval.requesterUser?.email ?? approval.requesterAgent?.name ?? "System"} · {approval.createdAt.toLocaleString()}</p>
                {approval.status === "pending" ? (
                  <div className="mt-4 flex gap-2">
                    {(["approved", "rejected"] as const).map((status) => <form key={status} action={decideApprovalAction}><Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} /><input type="hidden" name="approvalId" value={approval.id} /><input type="hidden" name="status" value={status} /><button className={status === "approved" ? button : secondaryButton}>{status === "approved" ? "Approve" : "Reject"}</button></form>)}
                  </div>
                ) : <p className="mt-3 text-xs text-[--muted-foreground]">Decision by {approval.reviewer?.name ?? approval.reviewer?.email ?? "Unknown"}{approval.decisionNote ? ` · ${approval.decisionNote}` : ""}</p>}
              </WorkspaceCard>
            ))}
          </div>
          <WorkspaceCard title="Request approval">
            <form action={createApprovalAction} className="space-y-3">
              <Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} />
              <label className="block text-xs text-[--muted-foreground]">Title<input required name="title" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Type<input name="type" defaultValue="organization_change" className={field} /></label>
              <label className="block text-xs text-[--muted-foreground]">Project<select name="projectId" className={field}><option value="">Workspace</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="block text-xs text-[--muted-foreground]">Description<textarea name="description" rows={4} className={`${field} h-auto py-2`} /></label>
              <button className={`${button} w-full`}>Submit request</button>
            </form>
          </WorkspaceCard>
        </div>
      </WorkspaceShell>
    );
  }

  if (section === "projects") {
    return (
      <WorkspaceShell>
        <WorkspaceHeader title="Projects" description={`Projects scoped to ${workspace.name}.`} accent={workspace.color} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="grid gap-3 md:grid-cols-2">{projects.length === 0 ? <div className="md:col-span-2"><Empty>No projects in this workspace.</Empty></div> : projects.map((project) => <WorkspaceCard key={project.id} title={project.name} description={project.description ?? "No description"}><p className="text-xs text-[--muted-foreground]">{project.status} · {project._count.tasks} tasks · {project._count.documents} documents</p></WorkspaceCard>)}</div>
          <WorkspaceCard title="New project"><form action={createProjectAction} className="space-y-3"><Scope workspaceId={workspace.id} workspaceSlug={workspace.slug} /><label className="block text-xs text-[--muted-foreground]">Name<input required name="name" className={field} /></label><label className="block text-xs text-[--muted-foreground]">Description<input name="description" className={field} /></label><label className="block text-xs text-[--muted-foreground]">Team<select name="teamId" className={field}><option value="">None</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><button className={`${button} w-full`}>Create project</button></form></WorkspaceCard>
        </div>
      </WorkspaceShell>
    );
  }

  const [taskCount, documentCount, upcomingMeetings] = await Promise.all([
    db.task.count({ where: { workspaceId: workspace.id } }),
    db.document.count({ where: { workspaceId: workspace.id } }),
    db.meeting.count({ where: { workspaceId: workspace.id, startsAt: { gte: new Date() } } }),
  ]);
  return (
    <WorkspaceShell>
      <WorkspaceHeader title={titleCase(section)} description={`${workspace.name} operational data.`} accent={workspace.color} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Projects" value={workspace._count.projects} color={workspace.color} />
        <StatCard label="Teams" value={workspace._count.teams} color={workspace.color} />
        <StatCard label="Tasks" value={taskCount} color={workspace.color} />
        <StatCard label="Documents" value={documentCount} color={workspace.color} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <WorkspaceCard title="Projects" actions={<FolderKanban className="h-4 w-4 text-[--primary]" />}>{projects.length === 0 ? <p className="text-xs text-[--muted-foreground]">No projects.</p> : <div className="space-y-2">{projects.slice(0, 6).map((project) => <div key={project.id} className="flex justify-between text-xs"><span>{project.name}</span><span className="text-[--muted-foreground]">{project.status}</span></div>)}</div>}</WorkspaceCard>
        <WorkspaceCard title="Teams" actions={<Users className="h-4 w-4 text-[--primary]" />}>{teams.length === 0 ? <p className="text-xs text-[--muted-foreground]">No teams.</p> : <div className="space-y-2">{teams.slice(0, 6).map((team) => <div key={team.id} className="flex justify-between text-xs"><span>{team.name}</span><span className="text-[--muted-foreground]">{team.memberUserIds.length + team.memberAgentIds.length} members</span></div>)}</div>}</WorkspaceCard>
        <WorkspaceCard title="Control status" actions={<ShieldCheck className="h-4 w-4 text-[--primary]" />}><div className="space-y-3 text-xs text-[--muted-foreground]"><p className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />Database-backed workspace</p><p className="flex items-center gap-2"><KeyRound className="h-3.5 w-3.5 text-emerald-400" />Request-time RBAC enabled</p><p className="flex items-center gap-2"><CalendarClock className="h-3.5 w-3.5 text-[--primary]" />{upcomingMeetings} upcoming meetings</p></div></WorkspaceCard>
      </div>
    </WorkspaceShell>
  );
}
