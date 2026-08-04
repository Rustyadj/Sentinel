"use client";

import { useEffect, useState } from "react";
import type { ElementType } from "react";
import {
  Shield, Target, Zap, BookOpen, Link2,
  FileText, Activity, AlertTriangle, CheckCircle2,
  Clock, ChevronRight, Terminal,
  Globe, AlertCircle, TrendingUp,
  TrendingDown, Minus, Search,
  Plus,
  Crosshair, Sword, ShieldCheck,
  Radar, Monitor, MousePointerClick, Package,
  Binoculars, KeyRound, ArrowUp, Share2, CloudUpload,
  Mail, Sparkles, Star, MonitorSmartphone, FileSignature,
  KeySquare, Bug, Fingerprint, ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Section = "console" | "red" | "blue" | "purple" | "intel" | "chains" | "techniques" | "reports";

// ─── Sub-navigation ────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Section; label: string; icon: ElementType; color: string }[] = [
  { id: "console", label: "Range Console", icon: Radar, color: "#6366f1" },
  { id: "red", label: "Red Team", icon: Sword, color: "#ef4444" },
  { id: "blue", label: "Blue Team", icon: ShieldCheck, color: "#3b82f6" },
  { id: "purple", label: "Purple Team", icon: Zap, color: "#8b5cf6" },
  { id: "intel", label: "Threat Intel", icon: Globe, color: "#f59e0b" },
  { id: "chains", label: "Attack Chains", icon: Link2, color: "#ef4444" },
  { id: "techniques", label: "Techniques", icon: BookOpen, color: "#10b981" },
  { id: "reports", label: "Reports", icon: FileText, color: "#64748b" },
];

function SubNav({ active, onSelect }: { active: Section; onSelect: (s: Section) => void }) {
  return (
    <div className="w-44 flex flex-col h-full bg-[--sidebar] border-r border-[#181b22] shrink-0 overflow-y-auto">
      <div className="px-3 py-3 border-b border-[#181b22]">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-[#c8cdd8]">Cyber Range</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] text-emerald-400 font-medium">All systems nominal</span>
        </div>
      </div>
      <div className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs transition-colors text-left",
              active === id
                ? "bg-white/10 text-white border border-white/10"
                : "text-[#5a5f6e] hover:bg-white/5 hover:text-[#c8cdd8]"
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

// ─── Shared components ─────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color, trend, sub }: {
  label: string;
  value: string | number;
  icon: ElementType;
  color: string;
  trend?: "up" | "down" | "flat";
  sub?: string;
}) {
  return (
    <div className="bg-white border border-[#e0e3ea] rounded-2xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {trend && (
          <div className={cn("flex items-center gap-1 text-[10px] font-medium",
            trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-[#7a8099]"
          )}>
            {trend === "up" ? <TrendingUp className="w-3 h-3" /> : trend === "down" ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-[#1a1d26] mb-0.5">{value}</div>
      <div className="text-xs text-[#7a8099]">{label}</div>
      {sub && <div className="text-[10px] text-[#aab0c0] mt-0.5">{sub}</div>}
    </div>
  );
}

function SeverityBadge({ level }: { level: "critical" | "high" | "medium" | "low" | "info" }) {
  const styles = {
    critical: "bg-red-500/15 text-red-600 border-red-500/20",
    high: "bg-orange-500/15 text-orange-600 border-orange-500/20",
    medium: "bg-yellow-500/15 text-yellow-700 border-yellow-500/20",
    low: "bg-blue-500/15 text-blue-600 border-blue-500/20",
    info: "bg-[#f5f6f9] text-[#7a8099] border-[#e0e3ea]",
  };
  return (
    <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border", styles[level])}>
      {level}
    </span>
  );
}

function StatusDot({ status }: { status: "active" | "completed" | "pending" | "failed" }) {
  const colors = { active: "#10b981", completed: "#6366f1", pending: "#f59e0b", failed: "#ef4444" };
  return <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors[status] }} />;
}

// ─── Range Console ─────────────────────────────────────────────────────────────

const CONSOLE_STATS = [
  { label: "Active Campaigns", value: "7", icon: Crosshair, color: "#8b7cf6", sub: "2 new today" },
  { label: "Compromised Hosts", value: "12", icon: Monitor, color: "#3b82f6", sub: "3 high value" },
  { label: "Phishing Click Rate", value: "18.7%", icon: MousePointerClick, color: "#10b981", sub: "+4.3% vs last 7d" },
  { label: "Vulnerabilities Found", value: "34", icon: AlertTriangle, color: "#ef4444", sub: "8 critical" },
  { label: "Tools Installed", value: "23", icon: Package, color: "#8b7cf6", sub: "5 updates" },
];

const CHAIN_PHASES = [
  { label: "Recon", icon: Binoculars, status: "complete" as const },
  { label: "Initial Access", icon: KeyRound, status: "complete" as const },
  { label: "Execution", icon: Terminal, status: "complete" as const },
  { label: "Privilege Esc.", icon: ArrowUp, status: "in-progress" as const },
  { label: "Lateral Movement", icon: Share2, status: "pending" as const },
  { label: "Exfiltration", icon: CloudUpload, status: "pending" as const },
];

const CONSOLE_TECHNIQUES = [
  { id: "T1566", name: "Phishing", campaigns: 23 },
  { id: "T1078", name: "Valid Accounts", campaigns: 12 },
  { id: "T1059", name: "Command Shell", campaigns: 8 },
  { id: "T1003", name: "Credential Dumping", campaigns: 6 },
  { id: "T1021", name: "Remote Services", campaigns: 5 },
];

const PHISHING_TEMPLATES = [
  { name: "Outlook - Secure Doc", icon: Mail, color: "#3b82f6", clickRate: 24.3, usage: 18 },
  { name: "Google Drive - Share", icon: MonitorSmartphone, color: "#ef4444", clickRate: 19.7, usage: 14 },
  { name: "HR - Policy Update", icon: Mail, color: "#f59e0b", clickRate: 17.2, usage: 22 },
  { name: "Docusign - Review", icon: FileSignature, color: "#3b82f6", clickRate: 12.1, usage: 9 },
  { name: "Password Reset", icon: KeySquare, color: "#3b82f6", clickRate: 9.8, usage: 31 },
];

const RECENT_ACTIVITY = [
  { title: "New host compromised", detail: "WEB-01.acme.local", time: "2m ago", icon: Monitor, color: "#10b981" },
  { title: "Phishing campaign launched", detail: "HR - Policy Update", time: "15m ago", icon: MousePointerClick, color: "#ef4444" },
  { title: "Credential dumped", detail: "john.doe@acme.local", time: "32m ago", icon: KeyRound, color: "#f59e0b" },
  { title: "New vulnerability found", detail: "CVE-2024-3094", time: "1h ago", icon: Bug, color: "#ef4444" },
  { title: "Lateral movement detected", detail: "WS-23 → DB-01", time: "2h ago", icon: ArrowRightLeft, color: "#8b7cf6" },
];

const MARKETPLACE_TOOLS = [
  { name: "Mimikatz", desc: "Credential dumping", rating: 4.8, icon: Fingerprint },
  { name: "BloodHound", desc: "AD enumeration", rating: 4.7, icon: Share2 },
  { name: "Cobalt Strike", desc: "Advanced C2", rating: 4.9, icon: Terminal },
  { name: "Responder", desc: "LLMNR/NBT-NS poisoner", rating: 4.6, icon: AlertCircle },
  { name: "Shellter", desc: "Shellcode injector", rating: 4.5, icon: Zap },
];

function ConsoleStatCard({ label, value, icon: Icon, color, sub }: {
  label: string;
  value: string;
  icon: ElementType;
  color: string;
  sub: string;
}) {
  return (
    <div className="bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-4">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-[--canvas-muted]">{label}</span>
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: color + "22" }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold text-[--canvas-foreground]">{value}</div>
      <div className="text-[11px] text-[--canvas-muted] mt-1">{sub}</div>
    </div>
  );
}

function ChainNode({ phase, isLast }: { phase: (typeof CHAIN_PHASES)[number]; isLast: boolean }) {
  const Icon = phase.icon;
  const ringColor = phase.status === "complete" ? "#10b981" : phase.status === "in-progress" ? "#f59e0b" : "#2a3344";
  const bgColor = phase.status === "complete" ? "#10b98122" : phase.status === "in-progress" ? "#f59e0b22" : "#1a2230";
  const statusLabel = phase.status === "complete" ? "Complete" : phase.status === "in-progress" ? "In Progress" : "Pending";
  const statusColor = phase.status === "complete" ? "#10b981" : phase.status === "in-progress" ? "#f59e0b" : "#5a6478";
  return (
    <div className="flex items-center flex-1">
      <div className="flex flex-col items-center gap-2 shrink-0">
        <div className="w-11 h-11 rounded-full flex items-center justify-center border-2" style={{ backgroundColor: bgColor, borderColor: ringColor }}>
          <Icon className="w-4.5 h-4.5" style={{ color: ringColor }} />
        </div>
        <div className="text-center">
          <div className="text-xs font-medium text-[--canvas-foreground] whitespace-nowrap">{phase.label}</div>
          <div className="text-[10px] font-medium mt-0.5" style={{ color: statusColor }}>{statusLabel}</div>
        </div>
      </div>
      {!isLast && <div className="h-px flex-1 mx-1 mb-6" style={{ backgroundColor: "#232c3d" }} />}
    </div>
  );
}

function RangeConsole() {
  const [toolsInstalled, setToolsInstalled] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/modules")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data?.installed)) setToolsInstalled(data.installed.length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const stats = CONSOLE_STATS.map((s) =>
    s.label === "Tools Installed" && toolsInstalled !== null ? { ...s, value: String(toolsInstalled) } : s
  );

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[--canvas] text-[--canvas-foreground]">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {stats.map((s) => <ConsoleStatCard key={s.label} {...s} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Attack Chain Progress */}
        <div className="xl:col-span-1 bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold text-[--canvas-foreground]">Attack Chain Progress</h2>
            <button className="text-[11px] text-[--canvas-muted] hover:text-[--canvas-foreground] transition-colors">View All</button>
          </div>
          <div className="flex items-start">
            {CHAIN_PHASES.map((phase, i) => (
              <ChainNode key={phase.label} phase={phase} isLast={i === CHAIN_PHASES.length - 1} />
            ))}
          </div>
        </div>

        {/* Technique Library */}
        <div className="bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[--canvas-foreground]">Technique Library</h2>
            <button className="text-[11px] text-[--canvas-muted] hover:text-[--canvas-foreground] transition-colors">View All</button>
          </div>
          <div className="space-y-2.5">
            {CONSOLE_TECHNIQUES.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className="text-[10px] font-mono font-bold text-[#a78bfa] bg-[#8b7cf6]/15 border border-[#8b7cf6]/20 px-1.5 py-0.5 rounded-md shrink-0">{t.id}</span>
                <span className="text-xs text-[--canvas-foreground] flex-1 truncate">{t.name}</span>
                <span className="text-[11px] text-[--canvas-muted] shrink-0">{t.campaigns} Campaigns</span>
              </div>
            ))}
          </div>
        </div>

        {/* Phishing Templates */}
        <div className="bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[--canvas-foreground]">Phishing Templates</h2>
            <button className="text-[11px] text-[--canvas-muted] hover:text-[--canvas-foreground] transition-colors">View All</button>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] uppercase tracking-wider text-[--canvas-muted] mb-2 px-0.5">
            <span>Template</span><span>Click Rate</span><span className="text-right">Usage</span>
          </div>
          <div className="space-y-1">
            {PHISHING_TEMPLATES.map((t) => {
              const Icon = t.icon;
              const rateColor = t.clickRate >= 20 ? "#10b981" : t.clickRate >= 15 ? "#f59e0b" : "#ef4444";
              return (
                <div key={t.name} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: t.color + "22" }}>
                      <Icon className="w-3 h-3" style={{ color: t.color }} />
                    </div>
                    <span className="text-xs text-[--canvas-foreground] truncate">{t.name}</span>
                  </div>
                  <span className="text-xs font-mono font-medium" style={{ color: rateColor }}>{t.clickRate}%</span>
                  <span className="text-xs text-[--canvas-muted] text-right">{t.usage}</span>
                </div>
              );
            })}
          </div>
          <button className="w-full mt-3 flex items-center justify-center gap-1.5 bg-[#7c6cf6] hover:bg-[#6d5cf0] text-white text-xs px-3 py-2 rounded-xl font-medium transition-colors">
            <Plus className="w-3.5 h-3.5" /> Build New Template
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Recent Activity */}
        <div className="bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-5">
          <h2 className="text-sm font-bold text-[--canvas-foreground] mb-4">Recent Activity</h2>
          <div className="space-y-3.5">
            {RECENT_ACTIVITY.map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: a.color + "22" }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: a.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[--canvas-foreground] font-medium truncate">{a.title}</div>
                    <div className="text-[11px] text-[--canvas-muted] truncate">{a.detail}</div>
                  </div>
                  <span className="text-[10px] text-[--canvas-muted] shrink-0">{a.time}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Build New Phishing Template */}
        <div className="bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-5">
          <h2 className="text-sm font-bold text-[--canvas-foreground]">Build New Phishing Template</h2>
          <p className="text-[11px] text-[--canvas-muted] mb-4">AI-powered template creation</p>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-[--canvas-muted] mb-1 block">Template Name</label>
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Invoice from Acme Corp"
                className="w-full bg-[--canvas] border border-[--canvas-card-border] rounded-lg px-3 py-2 text-xs text-[--canvas-foreground] placeholder:text-[--canvas-muted] outline-none focus:border-[#7c6cf6] transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] text-[--canvas-muted] mb-1 block">Category</label>
              <select className="w-full bg-[--canvas] border border-[--canvas-card-border] rounded-lg px-3 py-2 text-xs text-[--canvas-foreground] outline-none focus:border-[#7c6cf6] transition-colors">
                <option>Financial</option>
                <option>HR</option>
                <option>IT</option>
                <option>Shipping</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-[--canvas-muted] mb-1 block">Target Platform</label>
              <div className="grid grid-cols-2 gap-1.5">
                {["Outlook", "Gmail", "Office 365", "Other"].map((p) => (
                  <button key={p} className="flex items-center justify-center gap-1.5 bg-[--canvas] border border-[--canvas-card-border] rounded-lg px-2 py-1.5 text-[11px] text-[--canvas-foreground] hover:border-[#7c6cf6] transition-colors">
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setGenerateNotice("Template generation isn't wired up yet — this is a UI preview.")}
              className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-[#7c6cf6] to-[#a78bfa] hover:opacity-90 text-white text-xs px-3 py-2.5 rounded-xl font-medium transition-opacity"
            >
              <Sparkles className="w-3.5 h-3.5" /> Generate with AI
            </button>
            {generateNotice && <p className="text-[10px] text-[--canvas-muted] text-center">{generateNotice}</p>}
          </div>
        </div>

        {/* Marketplace */}
        <div className="bg-[--canvas-card] border border-[--canvas-card-border] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[--canvas-foreground]">Marketplace</h2>
            <button className="text-[11px] text-[--canvas-muted] hover:text-[--canvas-foreground] transition-colors">View All</button>
          </div>
          <div className="space-y-3">
            {MARKETPLACE_TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.name} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[--canvas] border border-[--canvas-card-border] flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5 text-[--canvas-muted]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-[--canvas-foreground] truncate">{t.name}</div>
                    <div className="text-[10px] text-[--canvas-muted] truncate">{t.desc}</div>
                  </div>
                  <div className="flex items-center gap-0.5 text-[10px] text-[--canvas-muted] shrink-0">
                    <Star className="w-3 h-3 fill-current text-[#f59e0b]" style={{ color: "#f59e0b" }} />
                    {t.rating}
                  </div>
                  <button className="text-[10px] bg-[#7c6cf6] hover:bg-[#6d5cf0] text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors shrink-0">
                    Install
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Red Team ──────────────────────────────────────────────────────────────────

const RED_OPERATIONS = [
  { name: "External Recon", phase: "Recon", status: "completed" as const, findings: 12 },
  { name: "Phishing — Spear", phase: "Initial Access", status: "active" as const, findings: 3 },
  { name: "Lateral Movement", phase: "Lateral", status: "pending" as const, findings: 0 },
  { name: "Data Exfiltration Sim", phase: "Exfil", status: "pending" as const, findings: 0 },
];

const RED_FINDINGS = [
  { title: "Admin shares accessible without auth", severity: "critical" as const, host: "10.0.1.15", tactic: "Discovery" },
  { title: "RDP exposed on internet", severity: "high" as const, host: "203.0.113.5", tactic: "Initial Access" },
  { title: "Kerberoastable accounts (4)", severity: "high" as const, host: "corp.local", tactic: "Cred Access" },
  { title: "LAPS not deployed on workstations", severity: "medium" as const, host: "OU=Workstations", tactic: "Privilege Esc" },
];

function RedTeam() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center">
          <Sword className="w-4 h-4 text-red-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Red Team</h1>
          <p className="text-xs text-[#7a8099]">Offensive operations · adversary simulation</p>
        </div>
        <button className="ml-auto flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Operation
        </button>
      </div>

      {/* Attack phases */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Current Campaign</h2>
        <div className="grid grid-cols-4 gap-2">
          {RED_OPERATIONS.map((op, i) => (
            <div key={op.name} className={cn("rounded-xl border p-3 relative", op.status === "active" ? "border-red-500/40 bg-red-500/5" : op.status === "completed" ? "border-emerald-500/30 bg-emerald-500/5" : "border-[#e0e3ea] bg-white")}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] uppercase tracking-wider text-[#aab0c0] font-medium">Phase {i + 1}</span>
                <StatusDot status={op.status} />
              </div>
              <div className="text-xs font-semibold text-[#1a1d26]">{op.name}</div>
              <div className="text-[10px] text-[#7a8099] mt-0.5">{op.phase}</div>
              {op.findings > 0 && (
                <div className="mt-2 text-[10px] font-medium text-red-600">{op.findings} findings</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Findings table */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Findings ({RED_FINDINGS.length})</h2>
        <div className="bg-white border border-[#e0e3ea] rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
            <span>Finding</span><span>Severity</span><span>Host</span><span>Tactic</span>
          </div>
          {RED_FINDINGS.map((f, i) => (
            <div key={i} className={cn("grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
              <span className="text-sm text-[#1a1d26]">{f.title}</span>
              <SeverityBadge level={f.severity} />
              <span className="text-xs font-mono text-[#7a8099]">{f.host}</span>
              <span className="text-xs text-[#7a8099]">{f.tactic}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Tooling</h2>
        <div className="grid grid-cols-3 gap-2">
          {["Metasploit", "Cobalt Strike", "BloodHound", "Nmap", "Burp Suite", "Impacket"].map((t) => (
            <div key={t} className="bg-[#f5f6f9] border border-[#e0e3ea] rounded-lg px-3 py-2 flex items-center gap-2">
              <Terminal className="w-3 h-3 text-red-500 shrink-0" />
              <span className="text-xs font-mono text-[#1a1d26]">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Blue Team ─────────────────────────────────────────────────────────────────

const BLUE_ALERTS = [
  { title: "Brute force on SSH", host: "ssh.corp.com", time: "2m ago", severity: "high" as const, status: "active" as const },
  { title: "Anomalous DNS query volume", host: "dc01.corp.local", time: "15m ago", severity: "medium" as const, status: "active" as const },
  { title: "New admin account created", host: "AD: corp.local", time: "1h ago", severity: "high" as const, status: "pending" as const },
  { title: "Unusual process spawn", host: "WKSTN-042", time: "2h ago", severity: "medium" as const, status: "completed" as const },
  { title: "Data transfer spike to ext IP", host: "db-prod-01", time: "3h ago", severity: "critical" as const, status: "completed" as const },
];

const BLUE_CONTROLS = [
  { name: "EDR Coverage", value: 96, color: "#10b981" },
  { name: "Patch Compliance", value: 88, color: "#6366f1" },
  { name: "MFA Enrollment", value: 94, color: "#10b981" },
  { name: "Log Collection", value: 100, color: "#10b981" },
  { name: "Backup Verification", value: 72, color: "#f59e0b" },
  { name: "Vulnerability Scan", value: 85, color: "#6366f1" },
];

function BlueTeam() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-blue-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Blue Team</h1>
          <p className="text-xs text-[#7a8099]">Defense · detection · incident response</p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Active Alerts" value={3} icon={AlertTriangle} color="#ef4444" trend="down" />
        <StatCard label="MTTR" value="18m" icon={Clock} color="#f59e0b" trend="down" sub="↓4m vs last week" />
        <StatCard label="Incidents Closed" value={24} icon={CheckCircle2} color="#10b981" trend="up" sub="this month" />
        <StatCard label="SIEM Events/hr" value="14.2k" icon={Activity} color="#6366f1" trend="flat" />
      </div>

      {/* Alerts */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Alert Queue</h2>
        <div className="space-y-2">
          {BLUE_ALERTS.map((a, i) => (
            <div key={i} className="flex items-center gap-3 bg-white border border-[#e0e3ea] rounded-xl px-4 py-3 hover:border-[#c8cdd8] transition-colors">
              <StatusDot status={a.status} />
              <SeverityBadge level={a.severity} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#1a1d26] font-medium truncate">{a.title}</div>
                <div className="text-[10px] text-[#aab0c0]">{a.host}</div>
              </div>
              <span className="text-[10px] text-[#aab0c0] shrink-0">{a.time}</span>
              {a.status === "active" && (
                <button className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-500/20 transition-colors font-medium">
                  Investigate
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Controls coverage */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Security Controls</h2>
        <div className="grid grid-cols-2 gap-3">
          {BLUE_CONTROLS.map((c) => (
            <div key={c.name} className="bg-white border border-[#e0e3ea] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#1a1d26] font-medium">{c.name}</span>
                <span className="text-xs font-mono font-bold" style={{ color: c.color }}>{c.value}%</span>
              </div>
              <div className="h-2 bg-[#e8eaf0] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${c.value}%`, backgroundColor: c.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Purple Team ───────────────────────────────────────────────────────────────

const PURPLE_EXERCISES = [
  { technique: "T1078 — Valid Accounts", status: "detected" as const, detection: "SIEM Rule 4624", gap: null },
  { technique: "T1059 — Command Script", status: "detected" as const, detection: "EDR Alert", gap: null },
  { technique: "T1055 — Process Injection", status: "missed" as const, detection: null, gap: "No memory scanning" },
  { technique: "T1003 — OS Cred Dump", status: "partial" as const, detection: "File access alert", gap: "No LSASS protection" },
  { technique: "T1021 — Remote Services", status: "detected" as const, detection: "Network rule", gap: null },
  { technique: "T1486 — Data Encrypted", status: "missed" as const, detection: null, gap: "No honeypot files" },
];

function PurpleTeam() {
  const detected = PURPLE_EXERCISES.filter(e => e.status === "detected").length;
  const missed = PURPLE_EXERCISES.filter(e => e.status === "missed").length;
  const partial = PURPLE_EXERCISES.filter(e => e.status === "partial").length;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/20 flex items-center justify-center">
          <Zap className="w-4 h-4 text-purple-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Purple Team</h1>
          <p className="text-xs text-[#7a8099]">Adversarial simulation + detection validation</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Techniques Tested" value={PURPLE_EXERCISES.length} icon={Target} color="#8b5cf6" />
        <StatCard label="Detected" value={detected} icon={CheckCircle2} color="#10b981" sub={`${Math.round(detected / PURPLE_EXERCISES.length * 100)}% detection rate`} />
        <StatCard label="Coverage Gaps" value={missed + partial} icon={AlertCircle} color="#ef4444" sub={`${missed} missed · ${partial} partial`} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Exercise Results</h2>
        <div className="bg-white border border-[#e0e3ea] rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_1fr_1fr] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
            <span>Technique</span><span>Result</span><span>Detection</span><span>Gap</span>
          </div>
          {PURPLE_EXERCISES.map((e, i) => (
            <div key={i} className={cn("grid grid-cols-[1fr_auto_1fr_1fr] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
              <span className="text-xs font-mono text-[#1a1d26]">{e.technique}</span>
              <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md",
                e.status === "detected" ? "bg-emerald-500/10 text-emerald-600" :
                e.status === "missed" ? "bg-red-500/10 text-red-600" :
                "bg-yellow-500/10 text-yellow-700"
              )}>{e.status}</span>
              <span className="text-xs text-[#7a8099]">{e.detection ?? "—"}</span>
              <span className="text-xs text-[#aab0c0]">{e.gap ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Threat Intel ──────────────────────────────────────────────────────────────

const THREAT_ACTORS = [
  { name: "APT29 — Cozy Bear", origin: "Russia", target: "Gov, Think Tanks", ttps: ["T1566", "T1078", "T1055"], active: true },
  { name: "Lazarus Group", origin: "DPRK", target: "Finance, Crypto", ttps: ["T1190", "T1059", "T1486"], active: true },
  { name: "FIN7", origin: "Eastern Europe", target: "Retail, Hospitality", ttps: ["T1566.001", "T1003", "T1021"], active: false },
];

const IOCS = [
  { type: "IP", value: "185.220.101.45", threat: "C2 Server", confidence: "High" },
  { type: "Domain", value: "update-service[.]net", threat: "Phishing", confidence: "High" },
  { type: "Hash", value: "d41d8cd98f00b204e9800998ecf8427e", threat: "Ransomware", confidence: "Medium" },
  { type: "IP", value: "45.33.32.156", threat: "Scanning", confidence: "Low" },
];

function ThreatIntel() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
          <Globe className="w-4 h-4 text-amber-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Threat Intelligence</h1>
          <p className="text-xs text-[#7a8099]">Threat actors · IOCs · campaign tracking</p>
        </div>
      </div>

      {/* Threat actors */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Tracked Threat Actors</h2>
        <div className="space-y-2">
          {THREAT_ACTORS.map((a) => (
            <div key={a.name} className="bg-white border border-[#e0e3ea] rounded-xl p-4 hover:border-[#c8cdd8] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-[#1a1d26]">{a.name}</span>
                    <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md",
                      a.active ? "bg-red-500/10 text-red-600" : "bg-[#f5f6f9] text-[#7a8099]"
                    )}>{a.active ? "Active" : "Dormant"}</span>
                  </div>
                  <div className="text-[10px] text-[#7a8099]">Origin: {a.origin} · Target: {a.target}</div>
                </div>
                <div className="flex gap-1 flex-wrap justify-end max-w-[180px]">
                  {a.ttps.map((t) => (
                    <span key={t} className="text-[9px] bg-indigo-500/10 text-indigo-600 px-1.5 py-0.5 rounded font-mono">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* IOCs */}
      <div>
        <h2 className="text-sm font-semibold text-[#1a1d26] mb-3">Indicators of Compromise</h2>
        <div className="bg-white border border-[#e0e3ea] rounded-xl overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
            <span>Type</span><span>Indicator</span><span>Threat</span><span>Confidence</span>
          </div>
          {IOCS.map((ioc, i) => (
            <div key={i} className={cn("grid grid-cols-[auto_1fr_1fr_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
              <span className="text-[9px] bg-[#f5f6f9] text-[#7a8099] border border-[#e0e3ea] px-1.5 py-0.5 rounded font-mono font-bold">{ioc.type}</span>
              <span className="text-xs font-mono text-[#1a1d26] truncate">{ioc.value}</span>
              <span className="text-xs text-[#7a8099]">{ioc.threat}</span>
              <span className={cn("text-[9px] font-bold",
                ioc.confidence === "High" ? "text-red-600" : ioc.confidence === "Medium" ? "text-amber-600" : "text-[#7a8099]"
              )}>{ioc.confidence}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Attack Chains ─────────────────────────────────────────────────────────────

const ATTACK_CHAINS = [
  {
    id: "ac1",
    name: "Ransomware Deployment",
    steps: ["Phishing Email", "Macro Execution", "PowerShell Cradle", "Lateral Movement", "Data Staging", "Encryption"],
    status: "active" as const,
    ttps: ["T1566.001", "T1059.001", "T1021.002", "T1074", "T1486"],
  },
  {
    id: "ac2",
    name: "APT Initial Access",
    steps: ["Spear Phish", "Exploit Public App", "Web Shell Drop", "Persistence", "Cred Harvest"],
    status: "completed" as const,
    ttps: ["T1566.002", "T1190", "T1505.003", "T1053", "T1003"],
  },
];

function AttackChains() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center">
          <Link2 className="w-4 h-4 text-red-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Attack Chains</h1>
          <p className="text-xs text-[#7a8099]">Multi-stage attack simulation chains</p>
        </div>
        <button className="ml-auto flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Chain
        </button>
      </div>

      {ATTACK_CHAINS.map((chain) => (
        <div key={chain.id} className="bg-white border border-[#e0e3ea] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#1a1d26]">{chain.name}</h3>
                <StatusDot status={chain.status} />
              </div>
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {chain.ttps.map((t) => (
                  <span key={t} className="text-[9px] bg-red-500/10 text-red-600 px-1.5 py-0.5 rounded font-mono">{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Step chain */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {chain.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-1 shrink-0">
                <div className={cn("rounded-xl px-3 py-2 text-xs font-medium border",
                  i === 0 ? "bg-red-500/10 border-red-500/20 text-red-700" :
                  i === chain.steps.length - 1 ? "bg-orange-500/10 border-orange-500/20 text-orange-700" :
                  "bg-[#f5f6f9] border-[#e0e3ea] text-[#7a8099]"
                )}>
                  <div className="text-[9px] text-[#aab0c0] mb-0.5">Step {i + 1}</div>
                  {step}
                </div>
                {i < chain.steps.length - 1 && <ChevronRight className="w-3 h-3 text-[#aab0c0] shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Technique Library (MITRE ATT&CK) ─────────────────────────────────────────

const TECHNIQUES = [
  { id: "T1566", name: "Phishing", tactic: "Initial Access", tested: true, detected: true },
  { id: "T1059", name: "Command Scripting", tactic: "Execution", tested: true, detected: true },
  { id: "T1078", name: "Valid Accounts", tactic: "Defense Evasion", tested: true, detected: false },
  { id: "T1055", name: "Process Injection", tactic: "Privilege Esc", tested: true, detected: false },
  { id: "T1021", name: "Remote Services", tactic: "Lateral Movement", tested: true, detected: true },
  { id: "T1003", name: "OS Cred Dumping", tactic: "Cred Access", tested: false, detected: false },
  { id: "T1486", name: "Data Encrypted", tactic: "Impact", tested: false, detected: false },
  { id: "T1190", name: "Exploit Public App", tactic: "Initial Access", tested: true, detected: true },
  { id: "T1053", name: "Scheduled Task", tactic: "Persistence", tested: false, detected: false },
  { id: "T1074", name: "Data Staged", tactic: "Collection", tested: true, detected: false },
  { id: "T1505", name: "Web Shell", tactic: "Persistence", tested: true, detected: true },
  { id: "T1110", name: "Brute Force", tactic: "Cred Access", tested: true, detected: true },
];

function TechniqueLibrary() {
  const [search, setSearch] = useState("");
  const filtered = TECHNIQUES.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase()) ||
    t.tactic.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Technique Library</h1>
          <p className="text-xs text-[#7a8099]">MITRE ATT&amp;CK — test coverage and detection status</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Techniques Known" value={TECHNIQUES.length} icon={BookOpen} color="#6366f1" />
        <StatCard label="Tested" value={TECHNIQUES.filter(t => t.tested).length} icon={Target} color="#f59e0b" />
        <StatCard label="Detected" value={TECHNIQUES.filter(t => t.detected).length} icon={CheckCircle2} color="#10b981" sub={`${Math.round(TECHNIQUES.filter(t => t.detected).length / TECHNIQUES.filter(t => t.tested).length * 100)}% detect rate`} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[#f5f6f9] border border-[#e0e3ea] rounded-xl px-3 py-2 focus-within:border-indigo-400 transition-colors">
        <Search className="w-3.5 h-3.5 text-[#aab0c0]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search techniques…" className="flex-1 bg-transparent text-sm text-[#1a1d26] placeholder:text-[#aab0c0] outline-none" />
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e0e3ea] rounded-xl overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 px-4 py-2.5 text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium border-b border-[#f0f2f7]">
          <span>ID</span><span>Technique</span><span>Tactic</span><span>Tested</span><span>Detected</span>
        </div>
        {filtered.map((t, i) => (
          <div key={t.id} className={cn("grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 px-4 py-3 items-center hover:bg-[#f8f9fb] transition-colors", i > 0 && "border-t border-[#f0f2f7]")}>
            <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-500/10 px-1.5 py-0.5 rounded">{t.id}</span>
            <span className="text-sm text-[#1a1d26]">{t.name}</span>
            <span className="text-xs text-[#7a8099]">{t.tactic}</span>
            <span className={cn("text-[10px] font-bold", t.tested ? "text-emerald-600" : "text-[#aab0c0]")}>
              {t.tested ? "✓" : "—"}
            </span>
            <span className={cn("text-[10px] font-bold", t.detected ? "text-emerald-600" : t.tested ? "text-red-500" : "text-[#aab0c0]")}>
              {t.detected ? "✓" : t.tested ? "✗" : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Reports ───────────────────────────────────────────────────────────────────

const REPORTS = [
  { title: "Q2 2026 Red Team Assessment", date: "Jun 15, 2026", type: "Red Team", pages: 42 },
  { title: "Active Directory Hardening Review", date: "Jun 8, 2026", type: "Blue Team", pages: 18 },
  { title: "Ransomware Readiness Exercise", date: "May 30, 2026", type: "Purple Team", pages: 31 },
  { title: "Threat Intelligence Digest — June", date: "Jun 1, 2026", type: "Intel", pages: 12 },
  { title: "MITRE Coverage Report Q2", date: "May 25, 2026", type: "Purple Team", pages: 8 },
];

function Reports() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-slate-500/15 border border-slate-500/20 flex items-center justify-center">
          <FileText className="w-4 h-4 text-slate-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1a1d26]">Reports</h1>
          <p className="text-xs text-[#7a8099]">Assessment reports and findings documentation</p>
        </div>
        <button className="ml-auto flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Report
        </button>
      </div>

      <div className="space-y-2">
        {REPORTS.map((r, i) => (
          <div key={i} className="flex items-center gap-4 bg-white border border-[#e0e3ea] rounded-xl px-4 py-3.5 hover:border-[#c8cdd8] hover:shadow-sm transition-all">
            <div className="w-9 h-9 rounded-xl bg-[#f5f6f9] border border-[#e0e3ea] flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-[#7a8099]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[#1a1d26] truncate">{r.title}</div>
              <div className="text-[10px] text-[#aab0c0] mt-0.5">{r.date} · {r.pages} pages</div>
            </div>
            <span className={cn("text-[9px] font-bold uppercase px-2 py-1 rounded-lg",
              r.type === "Red Team" ? "bg-red-500/10 text-red-600" :
              r.type === "Blue Team" ? "bg-blue-500/10 text-blue-600" :
              r.type === "Purple Team" ? "bg-purple-500/10 text-purple-600" :
              "bg-amber-500/10 text-amber-600"
            )}>{r.type}</span>
            <button className="text-[10px] text-indigo-600 hover:underline font-medium">View</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main CybersecurityPage ────────────────────────────────────────────────────

export function CybersecurityPage() {
  const [section, setSection] = useState<Section>("console");

  return (
    <div className="h-full flex overflow-hidden">
      <SubNav active={section} onSelect={setSection} />
      <div className="flex-1 overflow-hidden bg-[--background]">
        {section === "console" && <RangeConsole />}
        {section === "red" && <RedTeam />}
        {section === "blue" && <BlueTeam />}
        {section === "purple" && <PurpleTeam />}
        {section === "intel" && <ThreatIntel />}
        {section === "chains" && <AttackChains />}
        {section === "techniques" && <TechniqueLibrary />}
        {section === "reports" && <Reports />}
      </div>
    </div>
  );
}
