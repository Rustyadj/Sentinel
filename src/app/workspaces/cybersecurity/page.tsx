import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceCard, StatCard } from "@/components/workspace/WorkspaceCard";

const ATTACK_CHAIN = [
  { phase: "Recon",        technique: "OSINT + Shodan scan",         status: "complete", color: "#10B981" },
  { phase: "Initial Access", technique: "Phishing — credential harvest", status: "complete", color: "#10B981" },
  { phase: "Execution",    technique: "PowerShell dropper",           status: "running",  color: "#F59E0B" },
  { phase: "Persistence",  technique: "Registry key + scheduled task",status: "pending",  color: "#6b7280" },
  { phase: "Exfiltration", technique: "DNS tunneling via dnscat2",   status: "pending",  color: "#6b7280" },
];

const TECHNIQUES = [
  { id: "T1566.001", name: "Spearphishing Attachment",  tactic: "Initial Access",  severity: "high" },
  { id: "T1059.001", name: "PowerShell",                 tactic: "Execution",       severity: "high" },
  { id: "T1547.001", name: "Registry Run Keys",          tactic: "Persistence",     severity: "medium" },
  { id: "T1071.004", name: "DNS Application Protocol",   tactic: "C2",              severity: "medium" },
  { id: "T1027",     name: "Obfuscated Files",           tactic: "Defense Evasion", severity: "low" },
];

const PHISHING_TEMPLATES = [
  { name: "IT Password Reset",       sent: 842,  clicked: 287, rate: 34.1, status: "active" },
  { name: "DocuSign — Contract",     sent: 1230, clicked: 310, rate: 25.2, status: "active" },
  { name: "Slack Security Alert",    sent: 560,  clicked: 58,  rate: 10.4, status: "paused" },
  { name: "Microsoft 365 Login",     sent: 2100, clicked: 735, rate: 35.0, status: "active" },
];

const MARKETPLACE_TOOLS = [
  { name: "Metasploit Framework", version: "6.3.44", category: "Exploitation",   installed: true  },
  { name: "BloodHound CE",        version: "5.0.1",  category: "AD Recon",       installed: true  },
  { name: "Cobalt Strike Kit",    version: "4.9",    category: "C2 Framework",   installed: false },
  { name: "Responder",            version: "3.1.3",  category: "Credential Theft", installed: true },
  { name: "Sliver C2",            version: "1.5.39", category: "C2 Framework",   installed: false },
];

const SEVERITY_COLOR: Record<string, string> = {
  high:   "#EF4444",
  medium: "#F59E0B",
  low:    "#6b7280",
};

export default function RangeConsolePage() {
  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Range Console"
        description="Active attack simulation — authorized red team environment"
        accent="#EF4444"
        actions={
          <button className="h-8 px-4 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors">
            + New Campaign
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active Campaigns" value={3}   sub="2 red · 1 purple"   color="#EF4444" />
        <StatCard label="Threats Detected"  value={127} sub="last 30 days"       color="#F59E0B" />
        <StatCard label="Techniques Used"   value={34}  sub="across all ops"     color="#6366f1" />
        <StatCard label="Avg Click Rate"    value="26%" sub="phishing campaigns" color="#10B981" />
      </div>

      {/* Attack Chain + Technique Library */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        {/* Attack Chain */}
        <WorkspaceCard
          title="Attack Chain"
          description="Op: Shadow Serpent · Day 3 of 14"
          accent="#EF4444"
          className="lg:col-span-3"
          actions={
            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
              Running
            </span>
          }
        >
          <div className="space-y-2.5">
            {ATTACK_CHAIN.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: step.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[--canvas-card-foreground] truncate">
                      {step.phase}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wide shrink-0"
                      style={{ color: step.color }}
                    >
                      {step.status}
                    </span>
                  </div>
                  <span className="text-[11px] text-[--muted-foreground]">
                    {step.technique}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </WorkspaceCard>

        {/* Technique Library */}
        <WorkspaceCard
          title="Technique Library"
          description="MITRE ATT&CK mapping"
          className="lg:col-span-2"
        >
          <div className="space-y-2">
            {TECHNIQUES.map((t) => (
              <div key={t.id} className="flex items-start gap-2.5 py-1.5 border-b border-[--canvas-card-border] last:border-0">
                <span className="text-[10px] font-mono text-[--muted-foreground] shrink-0 mt-0.5">
                  {t.id}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-[--canvas-card-foreground] truncate">{t.name}</div>
                  <div className="text-[10px] text-[--muted-foreground]">{t.tactic}</div>
                </div>
                <span
                  className="text-[10px] shrink-0 mt-0.5 uppercase"
                  style={{ color: SEVERITY_COLOR[t.severity] }}
                >
                  {t.severity}
                </span>
              </div>
            ))}
          </div>
        </WorkspaceCard>
      </div>

      {/* Phishing Templates + Marketplace side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Phishing Templates */}
        <WorkspaceCard
          title="Phishing Templates"
          description="Click-rate analytics across all active campaigns"
          accent="#F59E0B"
          className="lg:col-span-2"
          actions={
            <button className="text-xs text-[--primary] hover:text-white transition-colors">
              + Build New Template
            </button>
          }
        >
          <div className="space-y-3">
            {PHISHING_TEMPLATES.map((t) => (
              <div key={t.name} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-[--canvas-card-foreground] truncate">
                      {t.name}
                    </span>
                    <span
                      className="text-xs font-bold shrink-0 ml-2"
                      style={{ color: t.rate > 30 ? "#EF4444" : t.rate > 20 ? "#F59E0B" : "#10B981" }}
                    >
                      {t.rate}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[--canvas-card-border] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${t.rate}%`,
                        backgroundColor: t.rate > 30 ? "#EF4444" : t.rate > 20 ? "#F59E0B" : "#10B981",
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[10px] text-[--muted-foreground]">
                      {t.clicked.toLocaleString()} / {t.sent.toLocaleString()} sent
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: t.status === "active" ? "#10B981" : "#6b7280" }}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </WorkspaceCard>

        {/* Marketplace */}
        <WorkspaceCard
          title="Marketplace"
          description="Installed tools & modules"
          actions={
            <a
              href="/workspaces/cybersecurity/marketplace"
              className="text-xs text-[--primary] hover:text-white transition-colors"
            >
              Browse all →
            </a>
          }
        >
          <div className="space-y-2.5">
            {MARKETPLACE_TOOLS.map((tool) => (
              <div key={tool.name} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-[--canvas-card-foreground] truncate">
                    {tool.name}
                  </div>
                  <div className="text-[10px] text-[--muted-foreground]">
                    {tool.category} · v{tool.version}
                  </div>
                </div>
                {tool.installed ? (
                  <span className="text-[10px] text-emerald-400 shrink-0">Installed</span>
                ) : (
                  <button className="text-[10px] px-2 py-0.5 rounded border border-[--primary]/40 text-[--primary] hover:bg-[--primary]/10 transition-colors shrink-0">
                    Install
                  </button>
                )}
              </div>
            ))}
          </div>
        </WorkspaceCard>
      </div>
    </WorkspaceShell>
  );
}
