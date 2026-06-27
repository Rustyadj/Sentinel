"use client";

import { useState } from "react";
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
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useKeyStore, maskKey } from "@/store/useKeyStore";

const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "agents", label: "Agent Defaults", icon: Bot },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "api", label: "API Keys", icon: Key },
];

export default function SettingsPage() {
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
