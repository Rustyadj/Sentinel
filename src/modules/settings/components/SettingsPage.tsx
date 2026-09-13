"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  User,
  Bot,
  Brain,
  Palette,
  Shield,
  Bell,
  Key,
  Eye,
  EyeOff,
  Check,
  X,
  LogOut,
  Puzzle,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useKeyStore, maskKey } from "@/store/useKeyStore";
import { moduleRegistry } from "@/lib/modules";

const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "agents", label: "Agent Defaults", icon: Bot },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "api", label: "API Keys", icon: Key },
  { id: "modules", label: "Modules", icon: Puzzle },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState("profile");

  return (
    <div className="flex h-full">
      {/* Settings nav */}
      <div className="w-48 border-r border-[--border] bg-[--sidebar] p-3 shrink-0">
        <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-3 px-2">
          Settings
        </div>
        <div className="space-y-0.5">
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                activeSection === id
                  ? "bg-[--primary]/15 text-[--primary]"
                  : "text-[--muted-foreground] hover:text-[--foreground] hover:bg-[--accent]"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-xl">
          {activeSection === "profile" && <ProfileSettings />}
          {activeSection === "agents" && <AgentSettings />}
          {activeSection === "memory" && <MemorySettings />}
          {activeSection === "appearance" && <AppearanceSettings />}
          {activeSection === "security" && <SecuritySettings />}
          {activeSection === "api" && <APIKeySettings />}
          {activeSection === "notifications" && <NotificationSettings />}
          {activeSection === "modules" && <ModulesSettings />}
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && (
          <p className="text-xs text-[--muted-foreground]">{description}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0 space-y-4">{children}</CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-[--foreground]">{label}</div>
        {description && (
          <div className="text-xs text-[--muted-foreground]">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn(!on)}
      className={cn(
        "w-10 h-5 rounded-full transition-colors relative",
        on ? "bg-[--primary]" : "bg-[--muted]"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function ProfileSettings() {
  const { data: session } = useSession();
  return (
    <>
      <SettingsSection title="Profile" description="Your account information">
        {session?.user?.image && (
          <div className="flex items-center gap-3 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.user.image}
              alt={session.user.name ?? "User"}
              className="w-12 h-12 rounded-full border border-[--border]"
            />
            <div>
              <div className="text-sm font-medium text-[--foreground]">
                {session.user.name}
              </div>
              <div className="text-xs text-[--muted-foreground]">
                {session.user.email}
              </div>
            </div>
          </div>
        )}
        <FieldRow label="Display name">
          <Input
            defaultValue={session?.user?.name ?? ""}
            className="w-48 h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Email">
          <Input
            defaultValue={session?.user?.email ?? ""}
            className="w-48 h-8 text-sm"
            readOnly
          />
        </FieldRow>
      </SettingsSection>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
        onClick={() => signOut({ callbackUrl: "/auth/signin" })}
      >
        <LogOut className="w-3.5 h-3.5" />
        Sign out
      </Button>
    </>
  );
}

function AgentSettings() {
  return (
    <SettingsSection
      title="Agent Defaults"
      description="Default settings for new agents"
    >
      <FieldRow label="Default model" description="Used when creating new agents">
        <select className="h-8 px-2 rounded border border-[--border] bg-[--muted] text-sm text-[--foreground]">
          <option>deepseek/deepseek-v4.1-flash</option>
          <option>claude-sonnet-4-6</option>
          <option>claude-opus-4-8</option>
          <option>gpt-4o</option>
        </select>
      </FieldRow>
      <FieldRow label="Default memory scope">
        <select className="h-8 px-2 rounded border border-[--border] bg-[--muted] text-sm text-[--foreground]">
          <option>project</option>
          <option>session</option>
          <option>org</option>
        </select>
      </FieldRow>
      <FieldRow
        label="Supervisor agent"
        description="Hermes Lisa orchestrates by default"
      >
        <Toggle defaultOn={true} />
      </FieldRow>
      <FieldRow
        label="Human approval gates"
        description="Require approval before destructive actions"
      >
        <Toggle defaultOn={true} />
      </FieldRow>
    </SettingsSection>
  );
}

function MemorySettings() {
  return (
    <SettingsSection
      title="Memory System"
      description="Control what gets stored and for how long"
    >
      <FieldRow
        label="Auto-save decisions"
        description="Save agent decision reasoning"
      >
        <Toggle defaultOn={true} />
      </FieldRow>
      <FieldRow label="Compress old conversations">
        <Toggle defaultOn={true} />
      </FieldRow>
      <FieldRow
        label="Quality threshold"
        description="Minimum importance score (0–10)"
      >
        <Input
          defaultValue="5.0"
          type="number"
          className="w-20 h-8 text-sm"
        />
      </FieldRow>
      <FieldRow label="Max memories per scope">
        <Input
          defaultValue="500"
          type="number"
          className="w-20 h-8 text-sm"
        />
      </FieldRow>
    </SettingsSection>
  );
}

function AppearanceSettings() {
  const themes = ["Dark (default)", "Darker", "Nord", "Custom"];
  return (
    <SettingsSection
      title="Appearance"
      description="Customize the look and feel"
    >
      <FieldRow label="Theme">
        <select className="h-8 px-2 rounded border border-[--border] bg-[--muted] text-sm text-[--foreground]">
          {themes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Sidebar collapsed by default">
        <Toggle />
      </FieldRow>
      <FieldRow label="Right panel open by default">
        <Toggle defaultOn={true} />
      </FieldRow>
      <FieldRow label="Compact mode">
        <Toggle />
      </FieldRow>
    </SettingsSection>
  );
}

function SecuritySettings() {
  return (
    <SettingsSection
      title="Security"
      description="Access control and audit settings"
    >
      <FieldRow
        label="Audit logging"
        description="Log all agent actions"
      >
        <Toggle defaultOn={true} />
      </FieldRow>
      <FieldRow
        label="Tool permission enforcement"
        description="Block unauthorized tool calls"
      >
        <Toggle defaultOn={true} />
      </FieldRow>
      <FieldRow label="Require approval for >$10 tool calls">
        <Toggle defaultOn={true} />
      </FieldRow>
    </SettingsSection>
  );
}

interface ApiKeyRowProps {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  onSave: (key: string) => void;
  onClear: () => void;
}

function ApiKeyRow({
  label,
  description,
  placeholder,
  value,
  onSave,
  onClear,
}: ApiKeyRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);

  const configured = !!value;

  if (editing) {
    return (
      <div className="py-3 border-b border-[--border] last:border-0 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[--foreground]">{label}</div>
            <div className="text-xs text-[--muted-foreground]">{description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type={visible ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="flex-1 h-8 text-xs font-mono bg-[--muted]"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="text-[--muted-foreground] hover:text-[--foreground]"
          >
            {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => {
              if (draft.trim()) {
                onSave(draft.trim());
                setDraft("");
              }
              setEditing(false);
            }}
          >
            <Check className="w-3 h-3" />
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setDraft("");
              setEditing(false);
            }}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-3 border-b border-[--border] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[--foreground]">{label}</div>
        <div className="text-xs font-mono text-[--muted-foreground] truncate">
          {configured ? maskKey(value) : description}
        </div>
      </div>
      <Badge
        variant={configured ? "success" : "secondary"}
        className="text-[10px] shrink-0"
      >
        {configured ? "connected" : "not set"}
      </Badge>
      {configured && (
        <button
          onClick={onClear}
          className="text-[--muted-foreground] hover:text-destructive transition-colors"
          title="Remove key"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs shrink-0"
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
      >
        {configured ? "Rotate" : "Add"}
      </Button>
    </div>
  );
}

function APIKeySettings() {
  const {
    anthropicKey,
    openaiKey,
    openrouterKey,
    setAnthropicKey,
    setOpenAIKey,
    setOpenRouterKey,
  } = useKeyStore();

  return (
    <>
      <SettingsSection
        title="API Keys"
        description="Your keys are stored only in this browser — never sent to any server."
      >
        <ApiKeyRow
          label="Anthropic"
          description="Used by Claude agents (Hermes Lisa, Claude Code, Red Teamer, Blue Defender)"
          placeholder="sk-ant-api03-…"
          value={anthropicKey}
          onSave={setAnthropicKey}
          onClear={() => setAnthropicKey("")}
        />
        <ApiKeyRow
          label="OpenAI"
          description="Used by Codex agent (GPT-4o)"
          placeholder="sk-proj-…"
          value={openaiKey}
          onSave={setOpenAIKey}
          onClear={() => setOpenAIKey("")}
        />
        <ApiKeyRow
          label="OpenRouter"
          description="Fallback provider — access any model via openrouter.ai"
          placeholder="sk-or-v1-…"
          value={openrouterKey}
          onSave={setOpenRouterKey}
          onClear={() => setOpenRouterKey("")}
        />
      </SettingsSection>
      <div className="text-[11px] text-[--muted-foreground] px-1 space-y-1">
        <p>
          Keys are persisted to <code className="text-[10px] bg-[--muted] px-1 rounded">localStorage</code> under{" "}
          <code className="text-[10px] bg-[--muted] px-1 rounded">hermes-api-keys</code>.
        </p>
        <p>
          Claude agents require an Anthropic key · Codex requires an OpenAI key · all agents can fall back to OpenRouter.
        </p>
      </div>
    </>
  );
}

function NotificationSettings() {
  return (
    <SettingsSection
      title="Notifications"
      description="Control when you get notified"
    >
      {(
        [
          ["Agent task completed", true],
          ["Agent requires approval", true],
          ["Security finding detected", true],
          ["Memory limit approaching", false],
          ["Workflow execution failed", true],
        ] as [string, boolean][]
      ).map(([label, on]) => (
        <FieldRow key={label} label={label}>
          <Toggle defaultOn={on} />
        </FieldRow>
      ))}
    </SettingsSection>
  );
}

function ModulesSettings() {
  const allModules = moduleRegistry.getAll().filter((m) => m.id !== "settings");
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [customModules, setCustomModules] = useState<{
    id: string; moduleId: string; label: string; icon: string; description: string; contentType: string; enabled: boolean;
  }[]>([]);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newIcon, setNewIcon] = useState("Puzzle");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    fetch("/api/modules").then(r => r.json()).catch(() => ({ installed: [], custom: [] }))
      .then(({ installed, custom }: { installed: { moduleId: string; enabled: boolean }[]; custom: typeof customModules }) => {
        const map: Record<string, boolean> = {};
        for (const mod of allModules) {
          const found = installed.find(i => i.moduleId === mod.id);
          map[mod.id] = found ? found.enabled : true;
        }
        setEnabledMap(map);
        setCustomModules(custom);
        setHydrated(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleModule(moduleId: string, enabled: boolean) {
    setEnabledMap(prev => ({ ...prev, [moduleId]: enabled }));
    await fetch(`/api/modules/${moduleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function createModule() {
    if (!newLabel.trim()) return;
    setSaving(true);
    const res = await fetch("/api/modules/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim(), description: newDesc.trim(), icon: newIcon }),
    });
    const mod = await res.json() as typeof customModules[0];
    setCustomModules(prev => [...prev, mod]);
    setNewLabel(""); setNewDesc(""); setNewIcon("Puzzle");
    setCreating(false);
    setSaving(false);
  }

  async function deleteCustomModule(id: string) {
    await fetch(`/api/modules/custom/${id}`, { method: "DELETE" });
    setCustomModules(prev => prev.filter(m => m.id !== id));
  }

  const coreModules = allModules.filter(m => m.category === "core");
  const installableModules = allModules.filter(m => m.category === "installable");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-[#1a1d26]">Module Manager</h2>
        <p className="text-xs text-[#7a8099] mt-0.5">Enable or disable modules. Core modules are always active.</p>
      </div>

      {/* Core modules */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#aab0c0] font-medium mb-3">Core Modules</div>
        <div className="space-y-2">
          {coreModules.map((mod) => (
            <div key={mod.id} className="flex items-center gap-3 bg-[#f5f6f9] border border-[#e0e3ea] rounded-xl px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center shrink-0">
                <Puzzle className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#1a1d26]">{mod.label}</div>
                <div className="text-[10px] text-[#aab0c0]">{mod.description}</div>
              </div>
              <span className="text-[9px] font-bold uppercase text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">Core</span>
            </div>
          ))}
        </div>
      </div>

      {/* Installable modules */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#aab0c0] font-medium mb-3">Installable Modules</div>
        <div className="space-y-2">
          {installableModules.map((mod) => {
            const enabled = hydrated ? (enabledMap[mod.id] ?? true) : true;
            return (
              <div key={mod.id} className="flex items-center gap-3 bg-white border border-[#e0e3ea] rounded-xl px-4 py-3 hover:border-[#c8cdd8] transition-colors">
                <div className="w-8 h-8 rounded-lg bg-[#f5f6f9] border border-[#e0e3ea] flex items-center justify-center shrink-0">
                  <Puzzle className="w-4 h-4 text-[#7a8099]" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#1a1d26]">{mod.label}</div>
                  <div className="text-[10px] text-[#aab0c0]">{mod.description}</div>
                </div>
                <button
                  onClick={() => toggleModule(mod.id, !enabled)}
                  className={cn(
                    "relative w-10 h-5 rounded-full transition-colors shrink-0",
                    enabled ? "bg-indigo-600" : "bg-[#e0e3ea]"
                  )}
                >
                  <div className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform", enabled ? "translate-x-5" : "translate-x-0")} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom modules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-widest text-[#aab0c0] font-medium">Custom Modules</div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>

        {creating && (
          <div className="bg-[#f5f6f9] border border-[#e0e3ea] rounded-xl p-4 mb-3 space-y-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[#7a8099] font-medium mb-1">Module Name</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Finance Tracker" className="w-full bg-white border border-[#e0e3ea] rounded-lg px-3 py-2 text-sm text-[#1a1d26] outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[#7a8099] font-medium mb-1">Description</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What does this module do?" className="w-full bg-white border border-[#e0e3ea] rounded-lg px-3 py-2 text-sm text-[#1a1d26] outline-none focus:border-indigo-400" />
            </div>
            <div className="flex gap-2">
              <button onClick={createModule} disabled={saving || !newLabel.trim()} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create Module
              </button>
              <button onClick={() => setCreating(false)} className="text-xs text-[#7a8099] hover:text-[#1a1d26] px-3 py-2 rounded-lg border border-[#e0e3ea] hover:bg-[#f5f6f9] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {customModules.map((mod) => (
            <div key={mod.id} className="flex items-center gap-3 bg-white border border-[#e0e3ea] rounded-xl px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/15 flex items-center justify-center shrink-0">
                <Puzzle className="w-4 h-4 text-purple-500" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#1a1d26]">{mod.label}</div>
                <div className="text-[10px] text-[#aab0c0]">{mod.description || "Custom module"}</div>
              </div>
              <span className="text-[9px] font-bold uppercase text-purple-600 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-md">Custom</span>
              <button onClick={() => deleteCustomModule(mod.id)} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#aab0c0] hover:text-red-500 hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {customModules.length === 0 && !creating && (
            <div className="text-xs text-[#aab0c0] text-center py-4 border border-dashed border-[#e0e3ea] rounded-xl">
              No custom modules yet — create your first one
            </div>
          )}
        </div>
      </div>

      {/* SDK info */}
      <div className="bg-gradient-to-br from-indigo-500/8 to-purple-500/8 border border-indigo-500/15 rounded-2xl p-4">
        <div className="text-sm font-semibold text-[#1a1d26] mb-1">Module SDK</div>
        <div className="text-xs text-[#7a8099] leading-relaxed mb-3">
          Modules are self-registering Next.js components. Create a manifest.ts, a page component, and register with the module registry. Custom modules get their own route at <code className="bg-white border border-[#e0e3ea] px-1 rounded text-[10px] font-mono">/modules/[id]</code>.
        </div>
        <div className="bg-[#0f1013] rounded-lg p-3 font-mono text-[10px] text-[#c8cdd8] space-y-0.5">
          <div><span className="text-purple-400">moduleRegistry</span><span className="text-[#5a5f6e]">.</span><span className="text-blue-400">register</span><span className="text-[#5a5f6e]">({"{"}</span></div>
          <div className="pl-4"><span className="text-amber-400">id</span><span className="text-[#5a5f6e]">: </span><span className="text-emerald-400">&quot;my-module&quot;</span><span className="text-[#5a5f6e]">,</span></div>
          <div className="pl-4"><span className="text-amber-400">label</span><span className="text-[#5a5f6e]">: </span><span className="text-emerald-400">&quot;My Module&quot;</span><span className="text-[#5a5f6e]">,</span></div>
          <div className="pl-4"><span className="text-amber-400">href</span><span className="text-[#5a5f6e]">: </span><span className="text-emerald-400">&quot;/my-module&quot;</span><span className="text-[#5a5f6e]">,</span></div>
          <div className="pl-4"><span className="text-amber-400">category</span><span className="text-[#5a5f6e]">: </span><span className="text-emerald-400">&quot;installable&quot;</span><span className="text-[#5a5f6e]">,</span></div>
          <div className="pl-4"><span className="text-amber-400">order</span><span className="text-[#5a5f6e]">: </span><span className="text-orange-400">150</span></div>
          <div><span className="text-[#5a5f6e]">{"})"};</span></div>
        </div>
      </div>
    </div>
  );
}
