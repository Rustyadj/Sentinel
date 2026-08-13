"use client";

import { useState } from "react";
import {
  X, Sparkles, Loader2, Plus, Trash2, ChevronDown, ChevronRight,
  Wand2, Scissors, Maximize2, Minimize2, Zap, Megaphone, Copy, Check, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HOOK_STYLES, HOOK_STYLE_LABELS, SCRIPT_MODES,
  type ContentItem, type ContentHook, type HookStyle, type ScriptMode,
} from "../types";

async function readSSE(response: Response, onToken: (text: string) => void): Promise<void> {
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

function parseOutlineText(text: string) {
  return text
    .split("\n")
    .map((l) => l.replace(/^[\s\d.\-•)]+/, "").trim())
    .filter(Boolean)
    .map((t) => ({ id: crypto.randomUUID(), text: t }));
}

const QUICK_ACTIONS: Array<{ label: string; icon: typeof Wand2; instruction: string }> = [
  { label: "Rewrite", icon: Wand2, instruction: "Rewrite this script to be sharper and more engaging." },
  { label: "Expand", icon: Maximize2, instruction: "Expand this script with more detail and examples." },
  { label: "Condense", icon: Minimize2, instruction: "Condense this script to be tighter and more concise." },
  { label: "Improve Hook", icon: Zap, instruction: "Rewrite only the opening hook to be dramatically stronger." },
  { label: "Improve CTA", icon: Megaphone, instruction: "Strengthen the call to action at the end of this script." },
];

export function ScriptBuilder({
  item,
  onClose,
  onUpdated,
}: {
  item: ContentItem;
  onClose: () => void;
  onUpdated: (item: ContentItem) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content ?? "");
  const [outline, setOutline] = useState(item.outline);
  const [description, setDescription] = useState(item.description ?? "");
  const [tagsText, setTagsText] = useState(item.tags.join(", "));
  const [chapters, setChapters] = useState(item.chapters);
  const [hooks, setHooks] = useState<ContentHook[]>(item.hooks ?? []);
  const [showDetails, setShowDetails] = useState(false);

  const [mode, setMode] = useState<ScriptMode | "">("");
  const [instruction, setInstruction] = useState("");
  const [generating, setGenerating] = useState<"outline" | "script" | null>(null);

  const [hookStyleSel, setHookStyleSel] = useState<Set<HookStyle>>(new Set(HOOK_STYLES));
  const [hookCandidates, setHookCandidates] = useState<Array<{ style: string; text: string }>>([]);
  const [generatingHooks, setGeneratingHooks] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function generate(target: "outline" | "script", customInstruction?: string) {
    if (generating) return;
    setGenerating(target);
    const body = {
      target,
      instruction: customInstruction ?? instruction ?? undefined,
      mode: mode || undefined,
      currentContent: content || undefined,
      currentOutline: outline.map((o) => o.text).join("\n") || undefined,
    };
    let full = "";
    try {
      const res = await fetch(`/api/creator-studio/items/${item.id}/script/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "Generation failed");
        return;
      }
      await readSSE(res, (token) => {
        full += token;
        if (target === "script") setContent(full);
      });
      if (target === "outline") setOutline(parseOutlineText(full));
    } finally {
      setGenerating(null);
    }
  }

  async function generateHooks() {
    if (generatingHooks) return;
    setGeneratingHooks(true);
    setHookCandidates([]);
    try {
      const res = await fetch(`/api/creator-studio/items/${item.id}/hooks/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styles: [...hookStyleSel] }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "Hook generation failed");
        return;
      }
      const data = (await res.json()) as { variants: Array<{ style: string; text: string }> };
      setHookCandidates(data.variants ?? []);
    } finally {
      setGeneratingHooks(false);
    }
  }

  async function saveHook(candidate: { style: string; text: string }) {
    const res = await fetch(`/api/creator-studio/items/${item.id}/hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });
    if (res.ok) {
      const hook = (await res.json()) as ContentHook;
      setHooks((prev) => [hook, ...prev]);
    }
  }

  async function deleteHook(hookId: string) {
    setHooks((prev) => prev.filter((h) => h.id !== hookId));
    await fetch(`/api/creator-studio/items/${item.id}/hooks/${hookId}`, { method: "DELETE" });
  }

  async function toggleHookSelected(hook: ContentHook) {
    const nextSelected = !hook.selected;
    setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, selected: nextSelected } : h)));
    await fetch(`/api/creator-studio/items/${item.id}/hooks/${hook.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected: nextSelected }),
    });
  }

  function copyText(text: string, idx: number) {
    navigator.clipboard?.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }

  function toggleStyle(style: HookStyle) {
    setHookStyleSel((prev) => {
      const next = new Set(prev);
      if (next.has(style)) next.delete(style);
      else next.add(style);
      return next;
    });
  }

  function addChapter() {
    setChapters((prev) => [...prev, { timestamp: "0:00", title: "" }]);
  }
  function updateChapter(i: number, patch: Partial<{ timestamp: string; title: string }>) {
    setChapters((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeChapter(i: number) {
    setChapters((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addOutlineBeat() {
    setOutline((prev) => [...prev, { id: crypto.randomUUID(), text: "" }]);
  }
  function updateOutlineBeat(id: string, text: string) {
    setOutline((prev) => prev.map((b) => (b.id === id ? { ...b, text } : b)));
  }
  function removeOutlineBeat(id: string) {
    setOutline((prev) => prev.filter((b) => b.id !== id));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/creator-studio/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        outline,
        description,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        chapters,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const updated = (await res.json()) as ContentItem;
      onUpdated({ ...updated, hooks });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-end">
      <div className="w-full max-w-6xl bg-background border-l border-[--border] flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[--border] shrink-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 bg-transparent text-sm font-semibold text-[--foreground] outline-none"
          />
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1 text-xs text-[--muted-foreground] hover:text-[--foreground] px-2 py-1 rounded-md hover:bg-[--muted]"
          >
            {showDetails ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Details
          </button>
          <button
            onClick={save}
            disabled={saving}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors",
              saved ? "bg-emerald-500/15 text-emerald-500" : "bg-[--primary] text-[--primary-foreground]"
            )}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
          <button onClick={onClose} className="text-[--muted-foreground] hover:text-[--foreground] p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Details (YouTube fields) */}
        {showDetails && (
          <div className="border-b border-[--border] p-4 space-y-3 shrink-0 bg-[--card]">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[--muted-foreground]">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-[--border] bg-[--muted] px-3 py-2 text-xs text-[--foreground] outline-none focus:border-[--primary]/50"
                placeholder="Video description…"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[--muted-foreground]">Tags</label>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="mt-1 w-full h-8 rounded-lg border border-[--border] bg-[--muted] px-3 text-xs text-[--foreground] outline-none focus:border-[--primary]/50"
                placeholder="comma, separated, tags"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-[--muted-foreground]">Chapters</label>
                <button onClick={addChapter} className="text-[--primary] text-xs flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              <div className="mt-1.5 space-y-1.5">
                {chapters.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={c.timestamp}
                      onChange={(e) => updateChapter(i, { timestamp: e.target.value })}
                      className="w-16 h-7 rounded border border-[--border] bg-[--muted] px-1.5 text-[11px] font-mono text-[--foreground]"
                    />
                    <input
                      value={c.title}
                      onChange={(e) => updateChapter(i, { title: e.target.value })}
                      placeholder="Chapter title"
                      className="flex-1 h-7 rounded border border-[--border] bg-[--muted] px-2 text-[11px] text-[--foreground]"
                    />
                    <button onClick={() => removeChapter(i)} className="text-[--muted-foreground] hover:text-[--destructive]">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3-pane body */}
        <div className="flex-1 flex min-h-0">
          {/* Outline */}
          <div className="w-64 border-r border-[--border] flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[--border]">
              <span className="text-xs font-medium text-[--foreground]">Outline</span>
              <button
                onClick={() => generate("outline")}
                disabled={generating !== null}
                className="text-[10px] text-[--primary] flex items-center gap-1 disabled:opacity-40"
              >
                {generating === "outline" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Generate
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {outline.map((beat) => (
                <div key={beat.id} className="flex items-start gap-1.5">
                  <textarea
                    value={beat.text}
                    onChange={(e) => updateOutlineBeat(beat.id, e.target.value)}
                    rows={2}
                    className="flex-1 text-xs bg-[--muted] border border-[--border] rounded-md px-2 py-1.5 text-[--foreground] outline-none focus:border-[--primary]/50 resize-none"
                  />
                  <button onClick={() => removeOutlineBeat(beat.id)} className="text-[--muted-foreground] hover:text-[--destructive] mt-1.5">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button onClick={addOutlineBeat} className="w-full text-[10px] text-[--muted-foreground] hover:text-[--foreground] flex items-center justify-center gap-1 py-1.5 border border-dashed border-[--border] rounded-md">
                <Plus className="w-3 h-3" /> Add beat
              </button>
            </div>
          </div>

          {/* Script editor */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-[--border] overflow-x-auto">
              {QUICK_ACTIONS.map(({ label, icon: Icon, instruction: preset }) => (
                <button
                  key={label}
                  onClick={() => generate("script", preset)}
                  disabled={generating !== null}
                  className="flex items-center gap-1 text-[11px] text-[--muted-foreground] hover:text-[--foreground] px-2 py-1 rounded-md hover:bg-[--muted] disabled:opacity-40 shrink-0"
                >
                  <Icon className="w-3 h-3" /> {label}
                </button>
              ))}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ScriptMode | "")}
                className="ml-auto h-6 text-[10px] rounded border border-[--border] bg-[--muted] px-1.5 text-[--foreground] shrink-0"
              >
                <option value="">Default mode</option>
                {SCRIPT_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your script, or generate one with the AI assistant →"
              className="flex-1 w-full p-4 text-sm text-[--foreground] bg-transparent outline-none resize-none leading-relaxed font-mono"
              spellCheck={false}
            />
          </div>

          {/* AI Assistant + Hooks */}
          <div className="w-80 border-l border-[--border] flex flex-col shrink-0 overflow-y-auto">
            <div className="p-3 border-b border-[--border]">
              <div className="text-xs font-medium text-[--foreground] mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[--primary]" /> AI Assistant
              </div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="e.g. Make the hook more contrarian and shorten the middle section…"
                className="w-full text-xs bg-[--muted] border border-[--border] rounded-md px-2 py-1.5 text-[--foreground] outline-none focus:border-[--primary]/50 resize-none"
              />
              <button
                onClick={() => generate("script")}
                disabled={generating !== null}
                className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg py-1.5 disabled:opacity-40"
              >
                {generating === "script" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {generating === "script" ? "Writing…" : "Generate"}
              </button>
            </div>

            <div className="p-3">
              <div className="text-xs font-medium text-[--foreground] mb-2 flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5 text-[--primary]" /> Hook Generator
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {HOOK_STYLES.map((style) => (
                  <button
                    key={style}
                    onClick={() => toggleStyle(style)}
                    className={cn(
                      "text-[10px] px-2 py-1 rounded-full border transition-colors",
                      hookStyleSel.has(style)
                        ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]"
                        : "border-[--border] text-[--muted-foreground]"
                    )}
                  >
                    {HOOK_STYLE_LABELS[style]}
                  </button>
                ))}
              </div>
              <button
                onClick={generateHooks}
                disabled={generatingHooks || hookStyleSel.size === 0}
                className="w-full flex items-center justify-center gap-1.5 text-xs border border-[--border] rounded-lg py-1.5 text-[--foreground] hover:bg-[--muted] disabled:opacity-40"
              >
                {generatingHooks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generatingHooks ? "Generating…" : "Generate Hooks"}
              </button>

              {hookCandidates.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground]">Candidates</div>
                  {hookCandidates.map((c, i) => (
                    <div key={i} className="rounded-md border border-[--border] bg-[--muted] p-2">
                      <div className="text-[9px] uppercase text-[--primary] mb-1">{c.style}</div>
                      <p className="text-xs text-[--foreground] mb-1.5">{c.text}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => saveHook(c)} className="text-[10px] text-[--primary] flex items-center gap-1">
                          <Save className="w-3 h-3" /> Save
                        </button>
                        <button onClick={() => copyText(c.text, i)} className="text-[10px] text-[--muted-foreground] flex items-center gap-1">
                          {copiedIdx === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedIdx === i ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {hooks.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground]">Saved</div>
                  {hooks.map((h) => (
                    <div
                      key={h.id}
                      className={cn(
                        "rounded-md border p-2",
                        h.selected ? "border-[--primary]/40 bg-[--primary]/5" : "border-[--border] bg-[--card]"
                      )}
                    >
                      <div className="text-[9px] uppercase text-[--muted-foreground] mb-1">{h.style}</div>
                      <p className="text-xs text-[--foreground] mb-1.5">{h.text}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleHookSelected(h)} className="text-[10px] text-[--primary]">
                          {h.selected ? "Selected ✓" : "Select"}
                        </button>
                        <button onClick={() => deleteHook(h.id)} className="text-[--muted-foreground] hover:text-[--destructive]">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
