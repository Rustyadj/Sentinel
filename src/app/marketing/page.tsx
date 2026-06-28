"use client";

import { BarChart3, Users, Mail, Globe, TrendingUp, Plus, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

export default function MarketingPage() {
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[--foreground]">Marketing Center</h1>
          <p className="text-sm text-[--muted-foreground] mt-0.5">Leads · Campaigns · Content · SEO</p>
        </div>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" />
          New Campaign
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: "1,247", change: "+84 this week", icon: Users, color: "#8B5CF6" },
          { label: "Active Campaigns", value: "6", change: "3 running", icon: BarChart3, color: "#3B82F6" },
          { label: "Emails Sent", value: "12.4K", change: "38% open rate", icon: Mail, color: "#10B981" },
          { label: "Organic Traffic", value: "8.2K", change: "+12% MoM", icon: Globe, color: "#F59E0B" },
        ].map(({ label, value, change, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
                  <Icon className="w-4 h-4" style={{ color } as React.CSSProperties} />
                </div>
              </div>
              <div className="text-2xl font-bold text-[--foreground]">{value}</div>
              <div className="text-xs text-[--muted-foreground]">{label}</div>
              <div className="text-[10px] text-emerald-400 mt-1">{change}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <LeadsPanel />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <CampaignsPanel />
        </TabsContent>
        <TabsContent value="content" className="mt-4">
          <ContentPanel />
        </TabsContent>
        <TabsContent value="seo" className="mt-4">
          <SEOPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LeadsPanel() {
  const leads = [
    { name: "Sarah Chen", company: "TechFlow Inc", title: "CTO", status: "qualified", score: 92, source: "LinkedIn" },
    { name: "Marcus Webb", company: "Apex Solutions", title: "VP Engineering", status: "contacted", score: 78, source: "Referral" },
    { name: "Priya Nair", company: "DataSync", title: "Head of AI", status: "new", score: 85, source: "Website" },
    { name: "Jordan Ellis", company: "CloudBase", title: "CEO", status: "negotiating", score: 96, source: "Conference" },
  ];

  const statusColors: Record<string, string> = {
    new: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    contacted: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    qualified: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    negotiating: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Lead Pipeline</CardTitle>
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
          <Search className="w-3 h-3" />
          Research with AI
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {leads.map((lead) => (
            <div key={lead.name} className="flex items-center gap-4 py-3 border-b border-[--border] last:border-0">
              <div className="w-9 h-9 rounded-full bg-[--primary]/20 flex items-center justify-center text-sm font-semibold text-[--primary] shrink-0">
                {lead.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[--foreground]">{lead.name}</div>
                <div className="text-xs text-[--muted-foreground]">{lead.title} · {lead.company}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-[--muted-foreground]">{lead.source}</div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[--muted-foreground]">Score:</span>
                  <span className="text-xs font-semibold text-[--foreground]">{lead.score}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${statusColors[lead.status]}`}>
                  {lead.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignsPanel() {
  const campaigns = [
    { name: "Q3 AI Outreach", status: "active", sent: 2840, opens: 38, clicks: 12 },
    { name: "Product Launch Drip", status: "active", sent: 1200, opens: 44, clicks: 18 },
    { name: "Re-engagement Flow", status: "paused", sent: 560, opens: 22, clicks: 4 },
  ];

  return (
    <div className="grid gap-4">
      {campaigns.map((c) => (
        <Card key={c.name}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-[--foreground]">{c.name}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[--muted-foreground]">
                  <span>{c.sent.toLocaleString()} sent</span>
                  <span>·</span>
                  <span>{c.opens}% opens</span>
                  <span>·</span>
                  <span>{c.clicks}% clicks</span>
                </div>
              </div>
              <Badge variant={c.status === "active" ? "success" : "secondary"}>{c.status}</Badge>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-[--muted-foreground]">
                <span>Open rate</span><span>{c.opens}%</span>
              </div>
              <Progress value={c.opens} className="h-1.5" />
              <div className="flex justify-between text-[10px] text-[--muted-foreground]">
                <span>Click rate</span><span>{c.clicks}%</span>
              </div>
              <Progress value={c.clicks} className="h-1.5" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ContentPanel() {
  const content = [
    { title: "The Future of AI Agents in Enterprise", type: "Blog", status: "published", date: "Jun 20" },
    { title: "Sentinel OS Product Announcement", type: "Press Release", status: "draft", date: "Jun 28" },
    { title: "AI Workflow Automation Guide", type: "Whitepaper", status: "in-review", date: "Jul 5" },
    { title: "Weekly AI Newsletter #12", type: "Email", status: "scheduled", date: "Jun 30" },
  ];

  const statusColor: Record<string, string> = {
    published: "text-emerald-400",
    draft: "text-[--muted-foreground]",
    "in-review": "text-amber-400",
    scheduled: "text-blue-400",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Content Calendar</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {content.map((item) => (
            <div key={item.title} className="flex items-center gap-3 py-2.5 border-b border-[--border] last:border-0">
              <Badge variant="outline" className="text-[9px] w-24 justify-center shrink-0">{item.type}</Badge>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[--foreground] truncate">{item.title}</div>
              </div>
              <div className="text-[10px] text-[--muted-foreground] shrink-0">{item.date}</div>
              <div className={`text-[10px] capitalize shrink-0 ${statusColor[item.status]}`}>{item.status}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SEOPanel() {
  const keywords = [
    { keyword: "AI mission control", position: 4, volume: 2400, difficulty: 42 },
    { keyword: "multi-agent AI platform", position: 7, volume: 1800, difficulty: 58 },
    { keyword: "AI workflow automation", position: 12, volume: 8900, difficulty: 71 },
    { keyword: "Sentinel OS", position: 1, volume: 560, difficulty: 8 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Keyword Rankings
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {keywords.map((kw) => (
            <div key={kw.keyword} className="flex items-center gap-4 py-2 border-b border-[--border] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[--foreground]">{kw.keyword}</div>
                <div className="text-[10px] text-[--muted-foreground]">{kw.volume.toLocaleString()} monthly searches</div>
              </div>
              <div className="text-center shrink-0">
                <div className={`text-sm font-bold ${kw.position <= 3 ? "text-emerald-400" : kw.position <= 10 ? "text-amber-400" : "text-[--muted-foreground]"}`}>
                  #{kw.position}
                </div>
              </div>
              <div className="w-16 shrink-0">
                <div className="text-[10px] text-[--muted-foreground] mb-1 text-right">{kw.difficulty} KD</div>
                <div className="h-1 rounded-full bg-[--muted]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${kw.difficulty}%`,
                      backgroundColor: kw.difficulty < 40 ? "#10B981" : kw.difficulty < 70 ? "#F59E0B" : "#EF4444",
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
