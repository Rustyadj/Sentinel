"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Loader2, PanelLeftOpen, Plus, Search, Trash2, X } from "lucide-react";
import { useGraphStore } from "@/store/useGraphStore";

interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  backlinks: string[];
  updatedAt: string;
}

interface NoteDetail extends NoteSummary {
  content: string;
}

interface NotesPanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Translucent dark-glass notes panel docked over the knowledge graph —
 * same visual role and glass treatment as ChatPanel, for the Knowledge
 * module. Real CRUD against /api/notes (ObsidianNote), no sample data.
 *
 * Clicking a note here focuses its node in the graph (via requestFocus).
 * The reverse — clicking a Note node in the graph opens it here — isn't
 * wired yet: the graph only carries the bridged KnowledgeObject id, and
 * resolving that back to the source ObsidianNote id needs a small lookup
 * that doesn't exist yet. Left as a real follow-up, not half-built here.
 */
export function NotesPanel({ collapsed, onToggleCollapsed }: NotesPanelProps) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const requestFocus = useGraphStore((state) => state.requestFocus);

  const loadNotes = useCallback((query: string) => {
    setLoading(true);
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    fetch(`/api/notes${params}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as NoteSummary[]) : []))
      .then(setNotes)
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = setTimeout(() => loadNotes(search), search ? 250 : 0);
    return () => clearTimeout(id);
  }, [search, loadNotes]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/notes/${selectedId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as NoteDetail) : null))
      .then((note) => {
        setDetail(note);
        if (note) requestFocus(note.title);
      })
      .catch(() => { /* keep whatever was showing */ });
    return () => controller.abort();
  }, [selectedId, requestFocus]);

  const handleCreate = useCallback(async () => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled", content: "" }),
    });
    if (!res.ok) return;
    const note = (await res.json()) as NoteDetail;
    setNotes((prev) => [{ ...note }, ...prev]);
    setSelectedId(note.id);
    setDetail(note);
  }, []);

  const handleSave = useCallback(async (next: { title: string; content: string; tags: string[] }) => {
    if (!detail) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const updated = (await res.json()) as NoteDetail;
        setDetail(updated);
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, title: updated.title, tags: updated.tags, updatedAt: updated.updatedAt } : n)));
      }
    } finally {
      setSaving(false);
    }
  }, [detail]);

  const handleDelete = useCallback(async () => {
    if (!detail) return;
    const res = await fetch(`/api/notes/${detail.id}`, { method: "DELETE" });
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== detail.id));
      setSelectedId(null);
      setDetail(null);
    }
  }, [detail]);

  if (collapsed) {
    return (
      <div className="pointer-events-auto absolute bottom-12 left-3 top-3 z-30 flex w-12 flex-col items-center rounded-xl border border-[#1a2a3c] bg-[#08121e]/92 py-3 shadow-2xl backdrop-blur-2xl">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand notes panel"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <BookOpen className="mt-2 h-3.5 w-3.5 text-[#4a5065]" />
      </div>
    );
  }

  return (
    <section
      aria-label="Notes"
      className="pointer-events-auto absolute bottom-4 left-3 top-0 z-30 flex w-[calc(100%-24px)] max-w-[330px] flex-col overflow-hidden rounded-xl border border-[#1a2a3c] bg-[#07111d]/88 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl xl:max-w-[376px]"
    >
      {selectedId ? (
        detail && detail.id === selectedId ? (
          <NoteEditor
            key={detail.id}
            note={detail}
            saving={saving}
            onBack={() => setSelectedId(null)}
            onSave={handleSave}
            onDelete={handleDelete}
            onCollapse={onToggleCollapsed}
          />
        ) : (
          <div className="flex flex-1 items-center gap-2 p-4 text-[11px] text-[#697084]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading note…
          </div>
        )
      ) : (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
            <BookOpen className="h-4 w-4 text-[#8b93a5]" />
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8b93a5]">Notes</span>
            <button
              type="button"
              onClick={handleCreate}
              aria-label="New note"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[#8b93a5] hover:bg-white/[0.06] hover:text-white"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse notes panel"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#697084] hover:bg-white/[0.06] hover:text-[#c8cdd8]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="border-b border-white/[0.06] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes…"
                className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-7 pr-2 text-[11px] text-[#d5dbe5] placeholder:text-white/30 outline-none focus:border-violet-400/40"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-[11px] text-[#697084]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading notes…
              </div>
            ) : notes.length === 0 ? (
              <div className="p-4 text-[11px] text-[#697084]">
                {search ? "No notes match your search." : "No notes yet — create one to see it appear in the graph."}
              </div>
            ) : (
              <ul role="list">
                {notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(note.id)}
                      className="flex w-full flex-col items-start gap-1 border-b border-white/[0.04] px-3 py-2.5 text-left hover:bg-white/[0.04]"
                    >
                      <span className="w-full truncate text-[12px] text-[#dbe5f1]">{note.title}</span>
                      <span className="flex w-full items-center gap-1.5 text-[9px] text-[#66758c]">
                        {note.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded bg-white/[0.05] px-1.5 py-0.5">{tag}</span>
                        ))}
                        {note.backlinks.length > 0 ? <span className="ml-auto shrink-0">{note.backlinks.length} linked</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function NoteEditor({
  note,
  saving,
  onBack,
  onSave,
  onDelete,
  onCollapse,
}: {
  note: NoteDetail;
  saving: boolean;
  onBack: () => void;
  onSave: (next: { title: string; content: string; tags: string[] }) => void;
  onDelete: () => void;
  onCollapse: () => void;
}) {
  // Uncontrolled edit buffers, seeded once from `note` — the parent renders
  // this with key={note.id}, so switching notes remounts fresh rather than
  // needing an effect to resync. A background save round-trip returning the
  // same note.id must NOT stomp in-progress typing, which a sync effect
  // keyed on note.title/content would do.
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to notes"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8b93a5] hover:bg-white/[0.06] hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {saving ? <Loader2 className="h-3 w-3 animate-spin text-[#697084]" /> : null}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete note"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[#8b93a5] hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse notes panel"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#697084] hover:bg-white/[0.06] hover:text-[#c8cdd8]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onSave({ title, content, tags: note.tags })}
        className="border-b border-white/[0.06] bg-transparent px-3 py-2.5 text-[13px] font-medium text-[#f0f3f8] outline-none"
        placeholder="Untitled"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => onSave({ title, content, tags: note.tags })}
        placeholder="Write here — [[Note Title]] links to another note and appears as a real edge in the graph."
        className="flex-1 resize-none bg-transparent px-3 py-2.5 text-[12px] leading-5 text-[#c5cedb] outline-none placeholder:text-white/25"
      />
      {note.backlinks.length > 0 ? (
        <div className="border-t border-white/[0.06] px-3 py-2 text-[9px] text-[#66758c]">
          {note.backlinks.length} note{note.backlinks.length === 1 ? "" : "s"} link here
        </div>
      ) : null}
    </>
  );
}
