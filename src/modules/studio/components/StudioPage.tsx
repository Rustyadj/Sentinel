"use client";

import { useState, useEffect, useRef } from "react";
import {
  Wand2,
  Code2,
  Eye,
  Save,
  Layers,
  Plus,
  Trash2,
  Loader2,
  Check,
  Copy,
  ChevronRight,
  ChevronDown,
  Sparkles,
  SplitSquareHorizontal,
  FileCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyStore } from "@/store/useKeyStore";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudioProject {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
  createdAt: string;
}

// ─── Component library ────────────────────────────────────────────────────────

const COMPONENT_LIBRARY = [
  {
    category: "Layout",
    items: [
      {
        name: "Hero Section",
        prompt:
          "Create a beautiful hero section with a headline, subtitle, CTA button, and a gradient background",
      },
      {
        name: "Card Grid",
        prompt:
          "Build a responsive 3-column card grid with image, title, description, and action button",
      },
      {
        name: "Sidebar Layout",
        prompt:
          "Create a two-column layout with a dark sidebar nav and main content area",
      },
      {
        name: "Split Screen",
        prompt:
          "Build a 50/50 split screen layout with content on left and image on right",
      },
    ],
  },
  {
    category: "Navigation",
    items: [
      {
        name: "Top Nav",
        prompt:
          "Create a sticky top navigation bar with logo, links, search, and CTA button",
      },
      {
        name: "Breadcrumbs",
        prompt:
          "Build a breadcrumb navigation component with chevron separators",
      },
      {
        name: "Tab Bar",
        prompt:
          "Create an animated tab bar with active indicator and icon+label tabs",
      },
      {
        name: "Pagination",
        prompt:
          "Build a pagination component with prev/next and page number buttons",
      },
    ],
  },
  {
    category: "Forms",
    items: [
      {
        name: "Login Form",
        prompt:
          "Create a polished login form with email/password, remember me, and social auth buttons",
      },
      {
        name: "Contact Form",
        prompt:
          "Build a contact form with name, email, subject, message, and submit button",
      },
      {
        name: "Search Bar",
        prompt:
          "Create an animated search bar with icon, suggestions dropdown, and clear button",
      },
      {
        name: "Settings Form",
        prompt:
          "Build a settings form with toggle switches, select dropdowns, and save button",
      },
    ],
  },
  {
    category: "Data Display",
    items: [
      {
        name: "Data Table",
        prompt:
          "Create a data table with sortable columns, row hover, pagination, and bulk actions",
      },
      {
        name: "Stats Cards",
        prompt:
          "Build 4 stat cards with icon, metric value, label, and trend indicator",
      },
      {
        name: "Timeline",
        prompt:
          "Create a vertical timeline component with dates, icons, titles, and descriptions",
      },
      {
        name: "Pricing Table",
        prompt:
          "Build a 3-tier pricing table with features list, popular badge, and CTA buttons",
      },
    ],
  },
  {
    category: "Feedback",
    items: [
      {
        name: "Toast Notifications",
        prompt:
          "Create a toast notification system with success, error, warning, info variants",
      },
      {
        name: "Alert Banners",
        prompt:
          "Build dismissible alert banners in 4 variants: info, success, warning, error",
      },
      {
        name: "Progress Bar",
        prompt:
          "Create animated progress bars with percentage labels and color variants",
      },
      {
        name: "Loading States",
        prompt:
          "Build a loading skeleton component for cards, text, and images",
      },
    ],
  },
  {
    category: "Marketing",
    items: [
      {
        name: "Feature Grid",
        prompt:
          "Create a features section with icon, title, description for 6 features in a 3x2 grid",
      },
      {
        name: "Testimonials",
        prompt:
          "Build a testimonial carousel with avatar, quote, name, and company",
      },
      {
        name: "CTA Banner",
        prompt:
          "Create a full-width CTA banner with headline, text, and two action buttons",
      },
      {
        name: "Logo Cloud",
        prompt:
          "Build a logo cloud section showing 8 company logos in a responsive grid",
      },
    ],
  },
];

const BRAND_COLORS = [
  { name: "Primary", value: "#6366f1" },
  { name: "Secondary", value: "#8b5cf6" },
  { name: "Accent", value: "#06b6d4" },
  { name: "Success", value: "#10b981" },
  { name: "Warning", value: "#f59e0b" },
  { name: "Danger", value: "#ef4444" },
  { name: "Dark", value: "#1a1d26" },
  { name: "Light", value: "#f5f6f9" },
];

// ─── SSE reader ───────────────────────────────────────────────────────────────

async function readGenerationStream(
  response: Response,
  onToken: (text: string) => void
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        try {
          const parsed = JSON.parse(raw) as { type: string; text?: string };
          if (parsed.type === "text" && parsed.text) onToken(parsed.text);
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Live preview ─────────────────────────────────────────────────────────────

function LivePreview({ code }: { code: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current || !code) return;
    const cleaned = code
      .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, "")
      .replace(/^export\s+default\s+/gm, "const Component = ")
      .replace(/^export\s+\{[^}]+\};?\s*$/gm, "");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #f8fafc; }</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const { useState, useEffect, useRef, useCallback } = React;
${cleaned}
const App = typeof Component !== 'undefined' ? Component : () => React.createElement('div', null, 'Preview not available');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
</body>
</html>`;
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
    }
  }, [code]);

  if (!code) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center bg-[#f8fafc]">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
          <Wand2 className="w-8 h-8 text-indigo-500" />
        </div>
        <div className="text-sm font-semibold text-[#1a1d26] mb-1">
          Sentinel Studio
        </div>
        <div className="text-xs text-[#aab0c0] max-w-xs">
          Describe what you want to build, or pick a component from the library
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      className="w-full h-full border-0"
      sandbox="allow-scripts"
      title="Live preview"
    />
  );
}

// ─── Left panel ───────────────────────────────────────────────────────────────

function LeftPanel({
  projects,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  projects: StudioProject[];
  activeId: string | null;
  onSelect: (p: StudioProject) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const [showProjects, setShowProjects] = useState(true);
  const [showBrand, setShowBrand] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="w-56 flex flex-col h-full bg-[--sidebar] border-r border-[#181b22] overflow-hidden shrink-0">
      <div className="px-3 py-3 border-b border-[#181b22]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#c8cdd8] flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5 text-indigo-400" /> Studio
          </span>
          <button
            onClick={onCreate}
            className="w-6 h-6 rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 flex items-center justify-center text-indigo-400 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Projects */}
        <button
          onClick={() => setShowProjects((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[9px] uppercase tracking-widest text-[#3a3f50] hover:text-[#7a8099] transition-colors font-medium"
        >
          {showProjects ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Designs ({projects.length})
        </button>

        {showProjects && (
          <div className="space-y-0.5">
            {projects.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors",
                  activeId === p.id
                    ? "bg-indigo-500/15 text-indigo-300"
                    : "text-[#7a8099] hover:bg-white/5 hover:text-[#c8cdd8]"
                )}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelect(p)}
              >
                <FileCode className="w-3 h-3 shrink-0 opacity-60" />
                <span className="text-xs truncate flex-1">{p.title}</span>
                {hoveredId === p.id && activeId !== p.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(p.id);
                    }}
                    className="text-[#3a3f50] hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {projects.length === 0 && (
              <div className="px-2 py-1.5 text-[10px] text-[#3a3f50]">
                No designs yet
              </div>
            )}
          </div>
        )}

        {/* Brand Kit */}
        <button
          onClick={() => setShowBrand((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[9px] uppercase tracking-widest text-[#3a3f50] hover:text-[#7a8099] transition-colors font-medium mt-2"
        >
          {showBrand ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Brand Kit
        </button>

        {showBrand && (
          <div className="px-2 space-y-2">
            <div>
              <div className="text-[9px] text-[#3a3f50] mb-1.5">Colors</div>
              <div className="grid grid-cols-4 gap-1">
                {BRAND_COLORS.map((c) => (
                  <button
                    key={c.name}
                    title={`${c.name}: ${c.value}`}
                    onClick={() => navigator.clipboard?.writeText(c.value)}
                    className="w-8 h-8 rounded-lg border border-[#1e2130] hover:scale-110 transition-transform"
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#3a3f50] mb-1">Typography</div>
              <div className="space-y-0.5">
                {["System UI", "Monospace"].map((f) => (
                  <div key={f} className="text-[10px] text-[#5a5f6e] px-1">
                    {f}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Right component panel ────────────────────────────────────────────────────

function ComponentPanel({ onInsert }: { onInsert: (prompt: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["Layout"]));

  function toggle(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="w-60 flex flex-col h-full bg-[#f5f6f9] border-l border-[#e0e3ea] overflow-hidden shrink-0">
      <div className="px-3 py-3 border-b border-[#e0e3ea]">
        <div className="text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium flex items-center gap-1.5">
          <Layers className="w-3 h-3" /> Component Library
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {COMPONENT_LIBRARY.map(({ category, items }) => (
          <div key={category} className="mb-1">
            <button
              onClick={() => toggle(category)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[9px] uppercase tracking-widest text-[#7a8099] hover:text-[#1a1d26] transition-colors font-medium"
            >
              {expanded.has(category) ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {category}
            </button>
            {expanded.has(category) && (
              <div className="space-y-0.5 mb-1">
                {items.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => onInsert(item.prompt)}
                    className="w-full text-left px-3 py-1.5 text-xs text-[#7a8099] hover:text-[#1a1d26] hover:bg-white rounded-lg transition-colors"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main StudioPage ──────────────────────────────────────────────────────────

type ViewMode = "preview" | "code" | "split";

export function StudioPage() {
  const { anthropicKey } = useKeyStore();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeProject, setActiveProject] = useState<StudioProject | null>(
    null
  );
  const [code, setCode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/studio")
      .then((r) => r.json())
      .then((data) => setProjects(data as StudioProject[]))
      .catch(() => {});
  }, []);

  async function generate(userPrompt: string) {
    if (!userPrompt.trim() || generating) return;
    setPrompt("");
    setGenerating(true);
    setCode("");
    setViewMode("preview");

    try {
      const res = await fetch("/api/studio/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(anthropicKey ? { "x-anthropic-key": anthropicKey } : {}),
        },
        body: JSON.stringify({ prompt: userPrompt }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "Generation failed");
        return;
      }

      let full = "";
      await readGenerationStream(res, (token) => {
        full += token;
        setCode(full);
      });
    } finally {
      setGenerating(false);
      promptRef.current?.focus();
    }
  }

  async function saveProject() {
    if (!code.trim()) return;
    setSaving(true);
    const title =
      activeProject?.title ?? `Design ${new Date().toLocaleString()}`;
    if (activeProject) {
      await fetch(`/api/studio/${activeProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: code }),
      });
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id ? { ...p, content: code } : p
        )
      );
    } else {
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: code }),
      });
      const project = (await res.json()) as StudioProject;
      setProjects((prev) => [project, ...prev]);
      setActiveProject(project);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function createNew() {
    setActiveProject(null);
    setCode("");
    setPrompt("");
    promptRef.current?.focus();
  }

  async function selectProject(p: StudioProject) {
    setActiveProject(p);
    const res = await fetch(`/api/studio/${p.id}`);
    const full = (await res.json()) as StudioProject;
    setCode(full.content);
  }

  async function deleteProject(id: string) {
    await fetch(`/api/studio/${id}`, { method: "DELETE" });
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProject?.id === id) {
      setActiveProject(null);
      setCode("");
    }
  }

  function copyCode() {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const viewModes: Array<[ViewMode, typeof Eye, string]> = [
    ["preview", Eye, "Preview"],
    ["code", Code2, "Code"],
    ["split", SplitSquareHorizontal, "Split"],
  ];

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: projects + brand */}
      <LeftPanel
        projects={projects}
        activeId={activeProject?.id ?? null}
        onSelect={selectProject}
        onCreate={createNew}
        onDelete={deleteProject}
      />

      {/* Center: canvas */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e3ea] bg-white shrink-0">
          {/* View mode tabs */}
          <div className="flex items-center bg-[#f5f6f9] rounded-lg p-0.5 gap-0.5">
            {viewModes.map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewMode === mode
                    ? "bg-white text-[#1a1d26] shadow-sm"
                    : "text-[#7a8099] hover:text-[#1a1d26]"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            {code && (
              <>
                <button
                  onClick={copyCode}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors",
                    copied
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : "text-[#7a8099] border-[#e0e3ea] hover:bg-[#f5f6f9]"
                  )}
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={saveProject}
                  disabled={saving}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors",
                    saved
                      ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/25"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  )}
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : saved ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {saving ? "Saving…" : saved ? "Saved" : "Save"}
                </button>
              </>
            )}
            {generating && (
              <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1.5 rounded-lg">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating…
              </div>
            )}
          </div>
        </div>

        {/* Canvas area */}
        <div
          className={cn(
            "flex-1 overflow-hidden min-h-0",
            viewMode === "split" && "flex"
          )}
        >
          {(viewMode === "preview" || viewMode === "split") && (
            <div
              className={cn(
                "overflow-hidden",
                viewMode === "split"
                  ? "flex-1 border-r border-[#e0e3ea]"
                  : "h-full"
              )}
            >
              <LivePreview code={code} />
            </div>
          )}
          {(viewMode === "code" || viewMode === "split") && (
            <div
              className={cn(
                "overflow-hidden flex flex-col",
                viewMode === "split" ? "flex-1" : "h-full"
              )}
            >
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="flex-1 w-full px-4 py-4 text-xs font-mono text-[#e2e5ed] bg-[#0f1013] outline-none resize-none leading-relaxed"
                placeholder="// Generated code will appear here…"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Prompt bar */}
        <div className="border-t border-[#e0e3ea] bg-white px-3 py-3 shrink-0">
          <div className="flex items-center gap-2 bg-[#f5f6f9] border border-[#e0e3ea] rounded-2xl px-3 py-2.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
            <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
            <input
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  generate(prompt);
                }
              }}
              placeholder="Describe what you want to build… (e.g. 'A pricing table with 3 tiers and toggle for monthly/annual')"
              className="flex-1 bg-transparent text-sm text-[#1a1d26] placeholder:text-[#aab0c0] outline-none"
              disabled={generating}
            />
            <button
              onClick={() => generate(prompt)}
              disabled={!prompt.trim() || generating}
              className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center transition-colors shrink-0"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 text-white" />
              )}
            </button>
          </div>
          <div className="mt-1.5 px-1 text-[10px] text-[#aab0c0]">
            Press Enter to generate · Pick a component from the library
            →
          </div>
        </div>
      </div>

      {/* Right: component library */}
      <ComponentPanel
        onInsert={(p) => {
          setPrompt(p);
          generate(p);
        }}
      />
    </div>
  );
}
