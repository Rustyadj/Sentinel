"use client";

import { useState } from "react";
import { BookOpen, Plus, Search, Tag, Hash, FileText, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SAMPLE_NOTES = [
  { id: "n1", title: "Project Goals - Sentinel OS", tags: ["project", "sentinel", "planning"], content: "# Sentinel OS Project Goals\n\nBuild a minimalist, clean AI mission control platform...\n\n## Core Requirements\n- Multi-agent collaboration\n- Persistent memory\n- Clean dark UI", folder: "Projects", updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000) },
  { id: "n2", title: "Agent Architecture Notes", tags: ["architecture", "agents", "design"], content: "## Agent Design Principles\n\nEach agent needs:\n- Unique identity and system prompt\n- Scoped memory access\n- Defined tool permissions", folder: "Architecture", updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  { id: "n3", title: "Memory System Design", tags: ["memory", "pgvector", "architecture"], content: "## Tiered Memory Architecture\n\n1. session_memory - ephemeral\n2. project_memory - per project\n3. org_memory - company wide\n4. vector_memory - semantic search", folder: "Architecture", updatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
  { id: "n4", title: "Daily Log - Jun 27", tags: ["daily", "log"], content: "## Today's Progress\n\n- Set up Next.js 16 project\n- Configured Tailwind CSS v4\n- Created Zustand stores\n- Built core layout components", folder: "Daily Logs", updatedAt: new Date(Date.now() - 30 * 60 * 1000) },
  { id: "n5", title: "Client: Acme Corp", tags: ["client", "acme", "crm"], content: "## Acme Corp Profile\n\n**Industry:** SaaS\n**Contact:** Jane Smith\n**Status:** Active\n**Key needs:** AI workflow automation", folder: "Clients", updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
];

const FOLDERS = ["All", "Projects", "Architecture", "Daily Logs", "Clients", "Agents"];

export default function ObsidianPage() {
  const [search, setSearch] = useState("");
  const [activeFolder, setActiveFolder] = useState("All");
  const [selectedNote, setSelectedNote] = useState(SAMPLE_NOTES[0]);

  const filtered = SAMPLE_NOTES.filter((note) => {
    const matchesFolder = activeFolder === "All" || note.folder === activeFolder;
    const matchesSearch = !search || note.title.toLowerCase().includes(search.toLowerCase()) || note.tags.some((t) => t.includes(search.toLowerCase()));
    return matchesFolder && matchesSearch;
  });

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-48 border-r border-[--border] bg-[--sidebar] flex flex-col shrink-0">
        <div className="p-3 border-b border-[--border]">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4 text-[--primary]" />
            <span className="text-sm font-medium text-[--foreground]">Vault</span>
            <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] px-2 mb-2">Folders</div>
          {FOLDERS.map((folder) => (
            <button
              key={folder}
              onClick={() => setActiveFolder(folder)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors",
                activeFolder === folder
                  ? "bg-[--primary]/15 text-[--primary]"
                  : "text-[--muted-foreground] hover:text-[--foreground] hover:bg-[--accent]"
              )}
            >
              <ChevronRight className="w-3 h-3" />
              {folder}
            </button>
          ))}
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] px-2 mt-4 mb-2">Tags</div>
          {["project", "architecture", "memory", "agents", "daily"].map((tag) => (
            <button key={tag} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[--muted-foreground] hover:text-[--foreground] hover:bg-[--accent] transition-colors">
              <Hash className="w-3 h-3" />
              {tag}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Note list */}
      <div className="w-64 border-r border-[--border] flex flex-col shrink-0">
        <div className="p-3 border-b border-[--border]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[--muted-foreground]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="pl-7 h-8 text-xs"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filtered.map((note) => (
              <button
                key={note.id}
                onClick={() => setSelectedNote(note)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md transition-colors",
                  selectedNote.id === note.id
                    ? "bg-[--primary]/15 border border-[--primary]/30"
                    : "hover:bg-[--accent] border border-transparent"
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText className="w-3 h-3 text-[--muted-foreground] shrink-0" />
                  <span className="text-xs font-medium text-[--foreground] truncate">{note.title}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {note.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="text-[9px] text-[--muted-foreground]">#{tag}</span>
                  ))}
                </div>
                <div className="text-[10px] text-[--muted-foreground] mt-1">
                  {note.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Note editor */}
      {selectedNote && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="border-b border-[--border] px-6 h-14 flex items-center gap-3 bg-[--card] shrink-0">
            <span className="font-medium text-sm text-[--foreground]">{selectedNote.title}</span>
            <div className="flex gap-1 ml-auto">
              {selectedNote.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[9px]">#{tag}</Badge>
              ))}
            </div>
          </div>
          <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-2xl mx-auto">
              <pre className="text-sm text-[--foreground] font-mono leading-relaxed whitespace-pre-wrap">
                {selectedNote.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
