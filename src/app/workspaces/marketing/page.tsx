import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceCard, StatCard } from "@/components/workspace/WorkspaceCard";

const CAMPAIGNS = [
  { name: "Q3 Product Launch",      channel: "Email + Social", status: "active",  leads: 1240, ctr: 4.2  },
  { name: "Developer Newsletter",   channel: "Email",          status: "active",  leads: 892,  ctr: 6.8  },
  { name: "Paid Search — Brand",    channel: "Google Ads",     status: "active",  leads: 3100, ctr: 2.1  },
  { name: "LinkedIn Outreach",      channel: "LinkedIn",       status: "paused",  leads: 420,  ctr: 1.4  },
];

const CONTENT = [
  { title: "10 Ways AI Transforms Security Ops", type: "Blog",          status: "published", views: 4821 },
  { title: "Sentinel OS Product Overview",        type: "Video",         status: "published", views: 2140 },
  { title: "Red Team Playbook 2026",              type: "Whitepaper",    status: "draft",     views: 0    },
  { title: "Customer Success: Acme Corp",         type: "Case Study",    status: "review",    views: 0    },
];

export default function MarketingPage() {
  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Marketing Console"
        description="Campaigns, leads, and content management"
        accent="#F59E0B"
        actions={
          <button className="h-8 px-4 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors">
            + New Campaign
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active Campaigns" value={3}      sub="1 paused"          color="#F59E0B" />
        <StatCard label="Total Leads"      value={5652}   sub="this quarter"      color="#6366f1" />
        <StatCard label="Avg CTR"          value="3.6%"   sub="across all email"  color="#10B981" />
        <StatCard label="Content Pieces"   value={4}      sub="2 in draft"        color="#3B82F6" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WorkspaceCard
          title="Campaigns"
          description="Active marketing campaigns"
          accent="#F59E0B"
          actions={
            <button className="text-xs text-[--primary] hover:text-white transition-colors">
              + New
            </button>
          }
        >
          <div className="space-y-3">
            {CAMPAIGNS.map((c) => (
              <div key={c.name} className="flex items-center gap-3 py-2 border-b border-[--canvas-card-border] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[--canvas-card-foreground] truncate">{c.name}</div>
                  <div className="text-[10px] text-[--muted-foreground]">{c.channel} · {c.leads.toLocaleString()} leads</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold" style={{ color: c.ctr > 5 ? "#10B981" : c.ctr > 3 ? "#F59E0B" : "#6b7280" }}>
                    {c.ctr}%
                  </div>
                  <div className="text-[10px]" style={{ color: c.status === "active" ? "#10B981" : "#6b7280" }}>
                    {c.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </WorkspaceCard>

        <WorkspaceCard
          title="Content"
          description="Published and in-progress content"
          actions={
            <button className="text-xs text-[--primary] hover:text-white transition-colors">
              + Create
            </button>
          }
        >
          <div className="space-y-2.5">
            {CONTENT.map((c) => (
              <div key={c.title} className="flex items-start gap-2.5 py-2 border-b border-[--canvas-card-border] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[--canvas-card-foreground] truncate">{c.title}</div>
                  <div className="text-[10px] text-[--muted-foreground]">{c.type}{c.views > 0 ? ` · ${c.views.toLocaleString()} views` : ""}</div>
                </div>
                <span
                  className="text-[10px] shrink-0 capitalize"
                  style={{ color: c.status === "published" ? "#10B981" : c.status === "review" ? "#F59E0B" : "#6b7280" }}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </WorkspaceCard>
      </div>
    </WorkspaceShell>
  );
}
