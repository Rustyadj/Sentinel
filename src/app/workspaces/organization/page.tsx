import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceCard, StatCard } from "@/components/workspace/WorkspaceCard";

const ORG_NODES = [
  { id: "ceo",    label: "CEO",         name: "Sarah Chen",    parent: null,  color: "#6366f1" },
  { id: "cto",    label: "CTO",         name: "Marcus Webb",   parent: "ceo", color: "#3B82F6" },
  { id: "cmo",    label: "CMO",         name: "Priya Sharma",  parent: "ceo", color: "#F59E0B" },
  { id: "cso",    label: "CSO",         name: "Alex Torres",   parent: "ceo", color: "#EF4444" },
  { id: "eng1",   label: "Eng Lead",    name: "Jordan Kim",    parent: "cto", color: "#3B82F6" },
  { id: "eng2",   label: "AI Lead",     name: "Riley Park",    parent: "cto", color: "#3B82F6" },
  { id: "mkt1",   label: "Growth",      name: "Sam Rivera",    parent: "cmo", color: "#F59E0B" },
  { id: "sec1",   label: "Red Team",    name: "Dana Cross",    parent: "cso", color: "#EF4444" },
];

const WORKFLOWS = [
  { name: "Onboarding Automation",   steps: 6, status: "active",  runs: 47  },
  { name: "Security Review Pipeline",steps: 4, status: "active",  runs: 12  },
  { name: "Content Approval",        steps: 3, status: "paused",  runs: 238 },
  { name: "Agent Deploy Checklist",  steps: 8, status: "active",  runs: 3   },
];

const BOARD_COLS = [
  { id: "todo",     label: "Backlog",     color: "#6b7280", cards: ["API rate limit fix", "Docs update", "Perf audit"] },
  { id: "progress", label: "In Progress", color: "#F59E0B", cards: ["Rail navigation", "Workspace registry", "Auth flow"] },
  { id: "review",   label: "In Review",   color: "#6366f1", cards: ["DB persistence", "Health endpoint"] },
  { id: "done",     label: "Done",        color: "#10B981", cards: ["Branding update", "Docker compose", "Sign-in page"] },
];

const TEAMS = [
  { name: "Engineering",  members: 12, lead: "Marcus Webb",  status: "active" },
  { name: "Security",     members: 6,  lead: "Alex Torres",  status: "active" },
  { name: "Marketing",    members: 8,  lead: "Priya Sharma", status: "active" },
  { name: "AI Research",  members: 4,  lead: "Riley Park",   status: "scaling" },
];

export default function OrganizationPage() {
  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Organization Console"
        description="Team, project, and workflow management"
        accent="#3B82F6"
        actions={
          <button className="h-8 px-4 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
            + Invite Member
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Teams"           value={4}   sub="all active"         color="#3B82F6" />
        <StatCard label="Active Projects" value={12}  sub="3 launching soon"   color="#6366f1" />
        <StatCard label="Workflows"       value={4}   sub="3 running"          color="#F59E0B" />
        <StatCard label="Members"         value={47}  sub="across all teams"   color="#10B981" />
      </div>

      {/* Top row: Org Chart + Workflows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Org Chart */}
        <WorkspaceCard
          title="Org Chart"
          description="Reporting structure"
          accent="#3B82F6"
        >
          {/* CEO */}
          <div className="flex flex-col items-center gap-3">
            {[null, "ceo", "cto", "cmo", "cso"].slice(0, 1).map(() => {
              const ceo = ORG_NODES.find(n => n.id === "ceo")!;
              return (
                <div key="ceo-row" className="flex flex-col items-center gap-3 w-full">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[--canvas-card-border] bg-[--background]/60 w-fit">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ceo.color }} />
                    <span className="text-xs font-semibold text-[--canvas-card-foreground]">{ceo.name}</span>
                    <span className="text-[10px] text-[--muted-foreground]">{ceo.label}</span>
                  </div>
                  <div className="w-px h-3 bg-[--canvas-card-border]" />
                  {/* Direct reports */}
                  <div className="flex items-start gap-3 w-full justify-center">
                    {ORG_NODES.filter(n => n.parent === "ceo").map((node) => (
                      <div key={node.id} className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[--canvas-card-border] bg-[--background]/60">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: node.color }} />
                          <span className="text-xs text-[--canvas-card-foreground]">{node.name}</span>
                          <span className="text-[10px] text-[--muted-foreground]">{node.label}</span>
                        </div>
                        {/* Reports to this person */}
                        {ORG_NODES.filter(n => n.parent === node.id).length > 0 && (
                          <>
                            <div className="w-px h-2 bg-[--canvas-card-border]" />
                            <div className="flex gap-2">
                              {ORG_NODES.filter(n => n.parent === node.id).map((child) => (
                                <div key={child.id} className="flex items-center gap-1 px-2 py-1 rounded border border-[--canvas-card-border] bg-[--background]/40">
                                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: child.color }} />
                                  <span className="text-[10px] text-[--muted-foreground]">{child.name}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </WorkspaceCard>

        {/* Workflows */}
        <WorkspaceCard
          title="Workflows"
          description="Automated pipelines"
          accent="#F59E0B"
          actions={
            <button className="text-xs text-[--primary] hover:text-white transition-colors">
              + New
            </button>
          }
        >
          <div className="space-y-3">
            {WORKFLOWS.map((wf) => (
              <div key={wf.name} className="flex items-center gap-3 py-2 border-b border-[--canvas-card-border] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[--canvas-card-foreground] truncate">
                    {wf.name}
                  </div>
                  <div className="text-[10px] text-[--muted-foreground]">
                    {wf.steps} steps · {wf.runs} runs total
                  </div>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full border shrink-0"
                  style={{
                    color: wf.status === "active" ? "#10B981" : "#6b7280",
                    borderColor: wf.status === "active" ? "#10B98133" : "#6b728033",
                    backgroundColor: wf.status === "active" ? "#10B98111" : "#6b728011",
                  }}
                >
                  {wf.status}
                </span>
              </div>
            ))}
          </div>
        </WorkspaceCard>
      </div>

      {/* Board + Teams */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Kanban Board preview */}
        <WorkspaceCard
          title="Board"
          description="Current sprint"
          className="lg:col-span-2"
          actions={
            <a href="/workspaces/organization/board" className="text-xs text-[--primary] hover:text-white transition-colors">
              Full board →
            </a>
          }
        >
          <div className="grid grid-cols-4 gap-2">
            {BOARD_COLS.map((col) => (
              <div key={col.id}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-[10px] font-semibold text-[--muted-foreground] uppercase tracking-wide">
                    {col.label}
                  </span>
                  <span className="text-[10px] text-[--muted-foreground]">· {col.cards.length}</span>
                </div>
                <div className="space-y-1.5">
                  {col.cards.map((card) => (
                    <div
                      key={card}
                      className="text-[10px] text-[--canvas-card-foreground] px-2 py-1.5 rounded bg-[--background]/60 border border-[--canvas-card-border] leading-tight"
                    >
                      {card}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </WorkspaceCard>

        {/* Teams */}
        <WorkspaceCard
          title="Teams"
          description="Active pods"
        >
          <div className="space-y-3">
            {TEAMS.map((team) => (
              <div key={team.name} className="flex items-center gap-3 py-1.5 border-b border-[--canvas-card-border] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[--canvas-card-foreground]">{team.name}</div>
                  <div className="text-[10px] text-[--muted-foreground]">{team.members} members · {team.lead}</div>
                </div>
                <span
                  className="text-[10px] shrink-0"
                  style={{ color: team.status === "scaling" ? "#F59E0B" : "#10B981" }}
                >
                  {team.status}
                </span>
              </div>
            ))}
          </div>
        </WorkspaceCard>
      </div>
    </WorkspaceShell>
  );
}
