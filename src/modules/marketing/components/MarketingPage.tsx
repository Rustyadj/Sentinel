"use client";

import { useState, type ElementType } from "react";
import {
  BarChart3, Users, Mail, Globe, TrendingUp, Plus, Search,
  Target, Megaphone, Bot, Layout, ChevronUp, ChevronDown,
  Building2, Clock, Filter,
  MousePointerClick, ArrowUpRight,
  Zap, FileText, Image, Link2, Hash, DollarSign,
  Briefcase, MoreHorizontal, Edit3,
  ExternalLink, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LensOverview } from "@/components/neural-lens/LensOverview";
import type { LensOverviewStats } from "@/lib/workspaces/lensStats";

type Section = "overview" | "dashboard" | "leads" | "crm" | "clients" | "campaigns" | "seo" | "analytics" | "agents" | "website";

// ─── Sub-navigation ───────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Section; label: string; icon: ElementType; color: string }[] = [
  { id: "overview", label: "Overview", icon: Globe, color: "#f59e0b" },
  { id: "dashboard", label: "Dashboard", icon: BarChart3, color: "#6366f1" },
  { id: "leads", label: "Leads", icon: Users, color: "#8b5cf6" },
  { id: "crm", label: "CRM", icon: Briefcase, color: "#06b6d4" },
  { id: "clients", label: "Clients", icon: Building2, color: "#10b981" },
  { id: "campaigns", label: "Campaigns", icon: Megaphone, color: "#f59e0b" },
  { id: "seo", label: "SEO", icon: Globe, color: "#3b82f6" },
  { id: "analytics", label: "Analytics", icon: TrendingUp, color: "#8b5cf6" },
  { id: "agents", label: "AI Agents", icon: Bot, color: "#ef4444" },
  { id: "website", label: "Website", icon: Layout, color: "#64748b" },
];

function SubNav({ active, onSelect }: { active: Section; onSelect: (s: Section) => void }) {
  return (
    <div className="w-44 flex flex-col h-full bg-[--sidebar] border-r border-[#181b22] shrink-0 overflow-y-auto">
      <div className="px-3 py-3 border-b border-[#181b22]">
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-[#c8cdd8]">Marketing OS</span>
        </div>
        <div className="text-[9px] text-[#3a3f50] mt-1">AvraxeAi · Primary</div>
      </div>
      <div className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs transition-colors text-left",
              active === id ? "bg-white/10 text-white border border-white/10" : "text-[#5a5f6e] hover:bg-white/5 hover:text-[#c8cdd8]"
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: active === id ? color : undefined }} />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub?: string;
  icon: ElementType; color: string; trend?: "up" | "down" | "flat";
}) {
  return (
    <div className="bg-white border border-[#e0e3ea] rounded-2xl p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {trend && (
          <span className={cn("text-[10px] font-medium flex items-center gap-0.5",
            trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-[#7a8099]"
          )}>
            {trend === "up" ? <ChevronUp className="w-3 h-3" /> : trend === "down" ? <ChevronDown className="w-3 h-3" /> : null}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-[#1a1d26] mb-0.5">{value}</div>
      <div className="text-xs text-[#7a8099]">{label}</div>
      {sub && <div className="text-[10px] text-[#aab0c0] mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    paused: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    draft: "bg-[#f5f6f9] text-[#7a8099] border-[#e0e3ea]",
    completed: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
    hot: "bg-red-500/10 text-red-600 border-red-500/20",
    warm: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    cold: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    qualified: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    new: "bg-teal-500/10 text-teal-600 border-teal-500/20",
    published: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  };
  return (
    <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border", styles[status] ?? styles.draft)}>
      {status}
    </span>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { name: "Awareness", count: 3420, value: 100 },
  { name: "Interest", count: 1280, value: 74 },
  { name: "Consideration", count: 640, value: 49 },
  { name: "Intent", count: 320, value: 30 },
  { name: "Purchase", count: 128, value: 18 },
];

const RECENT_ACTIVITY = [
  { event: "New lead from LinkedIn", who: "Marcus Chen", time: "2m ago", type: "lead" },
  { event: "Campaign 'Q3 Launch' went live", who: "Auto", time: "15m ago", type: "campaign" },
  { event: "Client Acme Corp renewed", who: "Sarah K.", time: "1h ago", type: "client" },
  { event: "SEO rank #1 for 'AI workflow'", who: "Organic", time: "3h ago", type: "seo" },
  { event: "Email campaign 38% open rate", who: "June Newsletter", time: "5h ago", type: "email" },
];

function Dashboard() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Marketing Dashboard</h1>
          <p className="text-xs text-[#7a8099] mt-0.5">AvraxeAi · June 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="text-xs bg-[#f5f6f9] border border-[#e0e3ea] rounded-lg px-2.5 py-1.5 text-[#7a8099] outline-none">
            <option>Last 30 days</option>
            <option>Last 90 days</option>
            <option>This year</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Total Leads" value="1,247" sub="+84 this week" icon={Users} color="#8b5cf6" trend="up" />
        <StatCard label="Active Campaigns" value="6" sub="3 running now" icon={Megaphone} color="#3b82f6" trend="flat" />
        <StatCard label="Email Open Rate" value="38%" sub="↑6% vs last month" icon={Mail} color="#10b981" trend="up" />
        <StatCard label="Organic Traffic" value="8.2K" sub="+12% MoM" icon={Globe} color="#f59e0b" trend="up" />
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-4">
        {/* Funnel */}
        <div className="bg-white border border-[#e0e3ea] rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-[#1a1d26] mb-4">Marketing Funnel</h2>
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#7a8099]">{stage.name}</span>
                  <span className="text-xs font-mono font-bold text-[#1a1d26]">{stage.count.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-[#e8eaf0] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all" style={{ width: `${stage.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity */}
        <div className="bg-white border border-[#e0e3ea] rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Recent Activity</h2>
          <div className="space-y-3">
            {RECENT_ACTIVITY.map((a, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  a.type === "lead" ? "bg-purple-500/15" : a.type === "campaign" ? "bg-blue-500/15" : a.type === "client" ? "bg-emerald-500/15" : a.type === "seo" ? "bg-amber-500/15" : "bg-indigo-500/15"
                )}>
                  {a.type === "lead" ? <Users className="w-3 h-3 text-purple-500" /> :
                   a.type === "campaign" ? <Megaphone className="w-3 h-3 text-blue-500" /> :
                   a.type === "client" ? <Building2 className="w-3 h-3 text-emerald-500" /> :
                   a.type === "seo" ? <Globe className="w-3 h-3 text-amber-500" /> :
                   <Mail className="w-3 h-3 text-indigo-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#1a1d26] leading-snug">{a.event}</div>
                  <div className="text-[10px] text-[#aab0c0] mt-0.5">{a.who} · {a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MRR + conversion */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="MRR" value="$12,400" sub="+$1,200 this month" icon={DollarSign} color="#10b981" trend="up" />
        <StatCard label="CAC" value="$48" sub="↓$6 vs last quarter" icon={Target} color="#6366f1" trend="down" />
        <StatCard label="Conversion Rate" value="3.7%" sub="Leads → Customers" icon={MousePointerClick} color="#f59e0b" trend="up" />
      </div>
    </div>
  );
}

// ─── Leads ────────────────────────────────────────────────────────────────────

const LEADS_DATA = [
  { name: "Marcus Chen", email: "marcus@techcorp.com", company: "TechCorp", source: "LinkedIn", status: "hot", score: 92, created: "Jun 28" },
  { name: "Sarah Williams", email: "sarah@startup.io", company: "Startup.io", source: "Website", status: "warm", score: 78, created: "Jun 27" },
  { name: "David Park", email: "david@enterprise.com", company: "Enterprise Ltd", source: "Referral", status: "qualified", score: 85, created: "Jun 26" },
  { name: "Emily Johnson", email: "emily@agency.co", company: "Agency Co", source: "Cold Email", status: "cold", score: 42, created: "Jun 25" },
  { name: "Alex Rivera", email: "alex@saas.io", company: "SaaS.io", source: "LinkedIn", status: "warm", score: 71, created: "Jun 24" },
  { name: "Jordan Lee", email: "jordan@media.com", company: "Media Corp", source: "Website", status: "new", score: 55, created: "Jun 23" },
  { name: "Taylor Smith", email: "taylor@consulting.net", company: "Consulting Net", source: "Event", status: "hot", score: 88, created: "Jun 22" },
];

function Leads() {
  const [search, setSearch] = useState("");
  const filtered = LEADS_DATA.filter(l =>
    !search || l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.company.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Leads</h1>
          <p className="text-xs text-[#7a8099]">{LEADS_DATA.length} total · {LEADS_DATA.filter(l => l.status === "hot").length} hot</p>
        </div>
        <button className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Lead
        </button>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white border border-[#e0e3ea] rounded-xl px-3 py-2 focus-within:border-indigo-400 transition-colors">
          <Search className="w-3.5 h-3.5 text-[#aab0c0]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="flex-1 bg-transparent text-sm text-[#1a1d26] placeholder:text-[#aab0c0] outline-none"
          />
        </div>
        <button className="flex items-center gap-1.5 text-xs text-[#7a8099] bg-white border border-[#e0e3ea] rounded-xl px-3 py-2 hover:bg-[#f5f6f9] transition-colors">
          <Filter className="w-3.5 h-3.5" /> Filter
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e0e3ea] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
          <span>Name</span><span>Company</span><span>Source</span><span>Score</span><span>Status</span><span></span>
        </div>
        {filtered.map((lead, i) => (
          <div key={i} className={cn("grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
            <div>
              <div className="text-sm font-medium text-[#1a1d26]">{lead.name}</div>
              <div className="text-[10px] text-[#aab0c0]">{lead.email}</div>
            </div>
            <span className="text-xs text-[#7a8099]">{lead.company}</span>
            <span className="text-xs text-[#7a8099] bg-[#f5f6f9] border border-[#e0e3ea] px-1.5 py-0.5 rounded-md">{lead.source}</span>
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1.5 bg-[#e8eaf0] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${lead.score}%`, backgroundColor: lead.score >= 80 ? "#10b981" : lead.score >= 60 ? "#f59e0b" : "#ef4444" }} />
              </div>
              <span className="text-[10px] font-mono text-[#7a8099]">{lead.score}</span>
            </div>
            <StatusBadge status={lead.status} />
            <div className="flex gap-1">
              <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-indigo-600 hover:bg-indigo-500/10 transition-colors"><Mail className="w-3.5 h-3.5" /></button>
              <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-[#1a1d26] hover:bg-[#f5f6f9] transition-colors"><MoreHorizontal className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CRM ─────────────────────────────────────────────────────────────────────

const CRM_PIPELINE = [
  {
    stage: "Prospecting", color: "#6366f1",
    deals: [
      { name: "TechCorp AI Suite", value: "$24K", contact: "Marcus Chen", days: 3 },
      { name: "Startup.io Growth", value: "$8K", contact: "Sarah W.", days: 7 },
    ]
  },
  {
    stage: "Qualified", color: "#8b5cf6",
    deals: [
      { name: "Enterprise Automation", value: "$120K", contact: "David Park", days: 12 },
    ]
  },
  {
    stage: "Proposal", color: "#f59e0b",
    deals: [
      { name: "Agency Co. Package", value: "$36K", contact: "Emily J.", days: 5 },
      { name: "SaaS.io Integration", value: "$18K", contact: "Alex R.", days: 9 },
    ]
  },
  {
    stage: "Negotiation", color: "#ef4444",
    deals: [
      { name: "Consulting Net Pro", value: "$55K", contact: "Taylor S.", days: 2 },
    ]
  },
  {
    stage: "Closed Won", color: "#10b981",
    deals: [
      { name: "Media Corp Annual", value: "$48K", contact: "Jordan L.", days: 0 },
    ]
  },
];

function CRM() {
  const totalValue = CRM_PIPELINE.flatMap(s => s.deals).reduce((sum, d) => {
    const numeric = d.value.replace(/[$K,]/g, "");
    return sum + parseInt(numeric) * 1000;
  }, 0);

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">CRM Pipeline</h1>
          <p className="text-xs text-[#7a8099]">Pipeline value: ${(totalValue / 1000).toFixed(0)}K</p>
        </div>
        <button className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Deal
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {CRM_PIPELINE.map((stage) => (
          <div key={stage.stage} className="w-56 shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
              <span className="text-xs font-semibold text-[#1a1d26]">{stage.stage}</span>
              <span className="text-[10px] text-[#aab0c0] ml-auto">{stage.deals.length}</span>
            </div>
            <div className="space-y-2">
              {stage.deals.map((deal, i) => (
                <div key={i} className="bg-white border border-[#e0e3ea] rounded-xl p-3 hover:shadow-sm hover:border-[#c8cdd8] transition-all cursor-pointer">
                  <div className="text-xs font-semibold text-[#1a1d26] mb-1">{deal.name}</div>
                  <div className="text-lg font-bold mb-1" style={{ color: stage.color }}>{deal.value}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#aab0c0]">{deal.contact}</span>
                    {deal.days > 0 && <span className="text-[9px] text-[#7a8099] bg-[#f5f6f9] px-1.5 py-0.5 rounded">{deal.days}d</span>}
                  </div>
                </div>
              ))}
              <button className="w-full flex items-center gap-1.5 px-2 py-2 text-[10px] text-[#aab0c0] hover:text-indigo-600 hover:bg-indigo-500/5 rounded-xl transition-colors border border-dashed border-[#e0e3ea] hover:border-indigo-400">
                <Plus className="w-3 h-3" /> Add deal
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Clients ──────────────────────────────────────────────────────────────────

const CLIENTS = [
  { name: "Acme Corporation", industry: "SaaS", contact: "Jane Smith", email: "jane@acme.com", mrr: "$2,400", status: "active", since: "Jan 2025", health: 95 },
  { name: "TechCorp", industry: "Enterprise", contact: "Marcus Chen", email: "marcus@techcorp.com", mrr: "$4,800", status: "active", since: "Mar 2025", health: 88 },
  { name: "Startup.io", industry: "Startup", contact: "Sarah Williams", email: "sarah@startup.io", mrr: "$800", status: "active", since: "May 2026", health: 72 },
  { name: "Media Corp", industry: "Media", contact: "Jordan Lee", email: "jordan@media.com", mrr: "$1,200", status: "active", since: "Jun 2026", health: 65 },
  { name: "Consulting Net", industry: "Professional Services", contact: "Taylor Smith", email: "taylor@consulting.net", mrr: "$3,200", status: "paused", since: "Feb 2025", health: 40 },
];

function Clients() {
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Clients</h1>
          <p className="text-xs text-[#7a8099]">{CLIENTS.filter(c => c.status === "active").length} active · $12.4K MRR</p>
        </div>
        <button className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Client
        </button>
      </div>

      <div className="space-y-3">
        {CLIENTS.map((client, i) => (
          <div key={i} className="bg-white border border-[#e0e3ea] rounded-2xl p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-indigo-600">{client.name.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#1a1d26]">{client.name}</span>
                  <StatusBadge status={client.status} />
                  <span className="text-[10px] text-[#aab0c0] bg-[#f5f6f9] px-1.5 py-0.5 rounded">{client.industry}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-[#7a8099]">{client.contact}</span>
                  <span className="text-[10px] text-[#aab0c0]">{client.email}</span>
                  <span className="text-[10px] text-[#aab0c0]">Since {client.since}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-[#1a1d26]">{client.mrr}</div>
                <div className="text-[10px] text-[#7a8099]">MRR</div>
              </div>
              <div className="w-20 shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-[#aab0c0]">Health</span>
                  <span className="text-[9px] font-mono" style={{ color: client.health >= 80 ? "#10b981" : client.health >= 60 ? "#f59e0b" : "#ef4444" }}>{client.health}%</span>
                </div>
                <div className="h-1.5 bg-[#e8eaf0] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${client.health}%`, backgroundColor: client.health >= 80 ? "#10b981" : client.health >= 60 ? "#f59e0b" : "#ef4444" }} />
                </div>
              </div>
              <div className="flex gap-1">
                <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-indigo-600 hover:bg-indigo-500/10 transition-colors"><Mail className="w-3.5 h-3.5" /></button>
                <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-[#1a1d26] hover:bg-[#f5f6f9] transition-colors"><ExternalLink className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

const CAMPAIGNS = [
  { name: "Q3 Product Launch", type: "Email", status: "active", sent: 8420, opens: 3201, clicks: 892, budget: "$2,000", spent: "$1,240", start: "Jun 15", end: "Jul 15" },
  { name: "LinkedIn AI Thought Leadership", type: "Social", status: "active", sent: 0, opens: 12400, clicks: 1840, budget: "$1,500", spent: "$800", start: "Jun 1", end: "Jun 30" },
  { name: "June Newsletter", type: "Email", status: "completed", sent: 4200, opens: 1596, clicks: 320, budget: "$500", spent: "$500", start: "Jun 1", end: "Jun 5" },
  { name: "Google Ads — Brand", type: "PPC", status: "active", sent: 0, opens: 24800, clicks: 3100, budget: "$3,000", spent: "$1,920", start: "Jun 1", end: "Jun 30" },
  { name: "Webinar: AI for Business", type: "Event", status: "draft", sent: 0, opens: 0, clicks: 0, budget: "$800", spent: "$0", start: "Jul 10", end: "Jul 10" },
];

function Campaigns() {
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Campaigns</h1>
          <p className="text-xs text-[#7a8099]">{CAMPAIGNS.filter(c => c.status === "active").length} active · {CAMPAIGNS.length} total</p>
        </div>
        <button className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Campaign
        </button>
      </div>

      <div className="space-y-2">
        {CAMPAIGNS.map((c, i) => (
          <div key={i} className="bg-white border border-[#e0e3ea] rounded-2xl p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#1a1d26]">{c.name}</span>
                  <StatusBadge status={c.status} />
                  <span className="text-[9px] bg-[#f5f6f9] text-[#7a8099] border border-[#e0e3ea] px-1.5 py-0.5 rounded-md font-medium">{c.type}</span>
                </div>
                <div className="text-[10px] text-[#aab0c0] mt-0.5">{c.start} → {c.end}</div>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button className="text-xs text-indigo-600 hover:underline px-2">Edit</button>
                <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-[#1a1d26] hover:bg-[#f5f6f9] transition-colors"><MoreHorizontal className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {c.sent > 0 && <div className="text-center"><div className="text-sm font-bold text-[#1a1d26]">{c.sent.toLocaleString()}</div><div className="text-[9px] text-[#aab0c0]">Sent</div></div>}
              <div className="text-center"><div className="text-sm font-bold text-[#1a1d26]">{c.opens.toLocaleString()}</div><div className="text-[9px] text-[#aab0c0]">{c.type === "Email" ? "Opens" : "Reach"}</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[#1a1d26]">{c.clicks.toLocaleString()}</div><div className="text-[9px] text-[#aab0c0]">Clicks</div></div>
              <div className="text-center">
                <div className="text-sm font-bold text-[#1a1d26]">{c.spent}</div>
                <div className="text-[9px] text-[#aab0c0]">of {c.budget}</div>
                <div className="mt-1 h-1 bg-[#e8eaf0] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded-full"
                    style={{
                      width: `${(parseInt(c.spent.replace(/[$,]/g, "")) / parseInt(c.budget.replace(/[$,]/g, ""))) * 100}%`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SEO ─────────────────────────────────────────────────────────────────────

const SEO_KEYWORDS = [
  { keyword: "AI workflow automation", position: 1, volume: 2400, difficulty: 62, change: +2 },
  { keyword: "AI operations platform", position: 4, volume: 1800, difficulty: 71, change: +1 },
  { keyword: "multi-agent AI", position: 7, volume: 3200, difficulty: 58, change: -1 },
  { keyword: "AI business automation", position: 12, volume: 5400, difficulty: 74, change: +4 },
  { keyword: "sentinel AI platform", position: 2, volume: 890, difficulty: 28, change: 0 },
  { keyword: "AI agent orchestration", position: 6, volume: 1200, difficulty: 55, change: +3 },
];

function SEO() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-lg font-bold text-[#1a1d26]">SEO</h1>
        <p className="text-xs text-[#7a8099]">Keyword rankings · organic performance</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Avg Position" value="5.3" sub="↑1.2 vs last month" icon={TrendingUp} color="#10b981" trend="up" />
        <StatCard label="Organic Traffic" value="8.2K" sub="+12% MoM" icon={Globe} color="#3b82f6" trend="up" />
        <StatCard label="Keywords Top 10" value={4} sub="of 6 tracked" icon={Hash} color="#8b5cf6" trend="up" />
        <StatCard label="Backlinks" value="342" sub="+18 this month" icon={Link2} color="#f59e0b" trend="up" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Tracked Keywords</h2>
        <div className="bg-white border border-[#e0e3ea] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
            <span>Keyword</span><span>Position</span><span>Volume</span><span>Difficulty</span><span>Change</span>
          </div>
          {SEO_KEYWORDS.map((kw, i) => (
            <div key={i} className={cn("grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
              <span className="text-sm text-[#1a1d26]">{kw.keyword}</span>
              <span className={cn("text-sm font-bold", kw.position <= 3 ? "text-emerald-600" : kw.position <= 10 ? "text-amber-600" : "text-[#7a8099]")}>#{kw.position}</span>
              <span className="text-xs text-[#7a8099]">{kw.volume.toLocaleString()}/mo</span>
              <div className="flex items-center gap-1">
                <div className="w-16 h-1.5 bg-[#e8eaf0] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${kw.difficulty}%`, backgroundColor: kw.difficulty >= 70 ? "#ef4444" : kw.difficulty >= 50 ? "#f59e0b" : "#10b981" }} />
                </div>
                <span className="text-[10px] text-[#7a8099]">{kw.difficulty}</span>
              </div>
              <span className={cn("text-xs font-bold", kw.change > 0 ? "text-emerald-600" : kw.change < 0 ? "text-red-500" : "text-[#aab0c0]")}>
                {kw.change > 0 ? `+${kw.change}` : kw.change === 0 ? "—" : kw.change}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Analytics ────────────────────────────────────────────────────────────────

const TRAFFIC_SOURCES = [
  { source: "Organic Search", sessions: 4120, pct: 50, color: "#10b981" },
  { source: "Direct", sessions: 2060, pct: 25, color: "#6366f1" },
  { source: "Social Media", sessions: 1236, pct: 15, color: "#f59e0b" },
  { source: "Email", sessions: 576, pct: 7, color: "#3b82f6" },
  { source: "Referral", sessions: 248, pct: 3, color: "#8b5cf6" },
];

const TOP_PAGES = [
  { page: "/", title: "Home", sessions: 3200, bounce: "42%", avg: "2:34" },
  { page: "/features", title: "Features", sessions: 1840, bounce: "38%", avg: "3:12" },
  { page: "/pricing", title: "Pricing", sessions: 1420, bounce: "61%", avg: "1:48" },
  { page: "/blog/ai-workflow", title: "AI Workflow Guide", sessions: 980, bounce: "28%", avg: "4:55" },
];

function Analytics() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-lg font-bold text-[#1a1d26]">Analytics</h1>
        <p className="text-xs text-[#7a8099]">Traffic · engagement · conversions</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Sessions" value="8,240" sub="+12% vs last month" icon={Activity} color="#6366f1" trend="up" />
        <StatCard label="Unique Visitors" value="5,180" sub="+8% MoM" icon={Users} color="#8b5cf6" trend="up" />
        <StatCard label="Bounce Rate" value="44%" sub="↓3% improvement" icon={ArrowUpRight} color="#10b981" trend="down" />
        <StatCard label="Avg Session" value="3:12" sub="+0:24 vs last month" icon={Clock} color="#f59e0b" trend="up" />
      </div>

      <div className="grid grid-cols-[1fr_240px] gap-4">
        {/* Top pages */}
        <div className="bg-white border border-[#e0e3ea] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0f2f7]">
            <h2 className="text-sm font-semibold text-[#1a1d26]">Top Pages</h2>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
            <span>Page</span><span>Sessions</span><span>Bounce</span><span>Avg Time</span>
          </div>
          {TOP_PAGES.map((p, i) => (
            <div key={i} className={cn("grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
              <div>
                <div className="text-sm text-[#1a1d26]">{p.title}</div>
                <div className="text-[10px] font-mono text-[#aab0c0]">{p.page}</div>
              </div>
              <span className="text-sm font-bold text-[#1a1d26]">{p.sessions.toLocaleString()}</span>
              <span className="text-xs text-[#7a8099]">{p.bounce}</span>
              <span className="text-xs text-[#7a8099]">{p.avg}</span>
            </div>
          ))}
        </div>

        {/* Traffic sources */}
        <div className="bg-white border border-[#e0e3ea] rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-[#1a1d26] mb-4">Traffic Sources</h2>
          <div className="space-y-3">
            {TRAFFIC_SOURCES.map((s) => (
              <div key={s.source}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#7a8099]">{s.source}</span>
                  <span className="text-xs font-mono text-[#1a1d26]">{s.pct}%</span>
                </div>
                <div className="h-2 bg-[#e8eaf0] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Agents ────────────────────────────────────────────────────────────────

const MARKETING_AGENTS = [
  { name: "Content Writer", avatar: "✍️", status: "active", task: "Writing Q3 blog post series", completions: 24 },
  { name: "Lead Scorer", avatar: "📊", status: "active", task: "Scoring 47 new leads from website", completions: 891 },
  { name: "Email Composer", avatar: "📧", status: "idle", task: "Waiting for campaign brief", completions: 156 },
  { name: "SEO Optimizer", avatar: "🔍", status: "active", task: "Analyzing competitor keyword gaps", completions: 38 },
  { name: "Social Scheduler", avatar: "📱", status: "idle", task: "Queue empty · 12 posts scheduled", completions: 204 },
  { name: "Ad Copywriter", avatar: "📣", status: "active", task: "A/B testing 8 headline variants", completions: 67 },
];

function AIAgents() {
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div>
        <h1 className="text-lg font-bold text-[#1a1d26]">AI Agents</h1>
        <p className="text-xs text-[#7a8099]">Marketing automation agents · {MARKETING_AGENTS.filter(a => a.status === "active").length} active</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {MARKETING_AGENTS.map((agent, i) => (
          <div key={i} className="bg-white border border-[#e0e3ea] rounded-2xl p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-indigo-500/15 flex items-center justify-center text-xl shrink-0">
                {agent.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-[#1a1d26]">{agent.name}</span>
                  <div className={cn("w-1.5 h-1.5 rounded-full", agent.status === "active" ? "bg-emerald-400" : "bg-[#aab0c0]")} />
                </div>
                <div className="text-[10px] text-[#7a8099] leading-relaxed">{agent.task}</div>
                <div className="text-[10px] text-[#aab0c0] mt-1.5">{agent.completions} tasks completed</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e0e3ea] rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Write Blog Post", icon: FileText },
            { label: "Score All Leads", icon: Target },
            { label: "Generate Email", icon: Mail },
            { label: "Analyze Competitors", icon: Search },
            { label: "Create Social Posts", icon: Image },
            { label: "Generate Ad Copy", icon: Megaphone },
          ].map(({ label, icon: Icon }) => (
            <button key={label} className="flex items-center gap-2 bg-[#f5f6f9] hover:bg-indigo-500/10 hover:text-indigo-700 border border-[#e0e3ea] hover:border-indigo-400/30 rounded-xl px-3 py-2 text-xs text-[#7a8099] transition-colors font-medium">
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Website ──────────────────────────────────────────────────────────────────

const WEBSITE_PAGES = [
  { path: "/", title: "Home", status: "published", lastEdit: "Jun 28" },
  { path: "/features", title: "Features", status: "published", lastEdit: "Jun 20" },
  { path: "/pricing", title: "Pricing", status: "published", lastEdit: "Jun 15" },
  { path: "/about", title: "About", status: "published", lastEdit: "Jun 1" },
  { path: "/blog", title: "Blog", status: "published", lastEdit: "Jun 29" },
  { path: "/contact", title: "Contact", status: "draft", lastEdit: "May 30" },
  { path: "/case-studies", title: "Case Studies", status: "draft", lastEdit: "May 20" },
];

function Website() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Website</h1>
          <p className="text-xs text-[#7a8099]">avraxeai.com · {WEBSITE_PAGES.filter(p => p.status === "published").length} pages live</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="#" className="flex items-center gap-1.5 text-xs text-[#7a8099] bg-white border border-[#e0e3ea] hover:bg-[#f5f6f9] px-3 py-2 rounded-lg transition-colors">
            <ExternalLink className="w-3.5 h-3.5" /> Preview
          </a>
          <button className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
            <Plus className="w-3.5 h-3.5" /> New Page
          </button>
        </div>
      </div>

      {/* Site stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pages Live" value={WEBSITE_PAGES.filter(p => p.status === "published").length} icon={Globe} color="#10b981" />
        <StatCard label="Core Web Vitals" value="Good" sub="LCP 1.2s · CLS 0.02" icon={Zap} color="#f59e0b" />
        <StatCard label="Uptime" value="99.9%" sub="Last 30 days" icon={Activity} color="#6366f1" />
      </div>

      {/* Pages */}
      <div className="bg-white border border-[#e0e3ea] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
          <span>Path</span><span>Title</span><span>Status</span><span>Last Edit</span><span></span>
        </div>
        {WEBSITE_PAGES.map((page, i) => (
          <div key={i} className={cn("grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
            <span className="text-[10px] font-mono text-[#7a8099] bg-[#f5f6f9] border border-[#e0e3ea] px-1.5 py-0.5 rounded-md">{page.path}</span>
            <span className="text-sm text-[#1a1d26] font-medium">{page.title}</span>
            <StatusBadge status={page.status} />
            <span className="text-[10px] text-[#aab0c0]">{page.lastEdit}</span>
            <div className="flex gap-1">
              <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-indigo-600 hover:bg-indigo-500/10 transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
              <button className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-[#1a1d26] hover:bg-[#f5f6f9] transition-colors"><ExternalLink className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main MarketingPage ───────────────────────────────────────────────────────

export function MarketingPage({ stats = null }: { stats?: LensOverviewStats | null }) {
  const [section, setSection] = useState<Section>("overview");

  return (
    <div className="h-full flex overflow-hidden">
      <SubNav active={section} onSelect={setSection} />
      <div className="flex-1 overflow-hidden bg-[--background]">
        {section === "overview" && <LensOverview lens="marketing" stats={stats} />}
        {section === "dashboard" && <Dashboard />}
        {section === "leads" && <Leads />}
        {section === "crm" && <CRM />}
        {section === "clients" && <Clients />}
        {section === "campaigns" && <Campaigns />}
        {section === "seo" && <SEO />}
        {section === "analytics" && <Analytics />}
        {section === "agents" && <AIAgents />}
        {section === "website" && <Website />}
      </div>
    </div>
  );
}
