"use client";

import { useEffect, useState } from "react";
import { NeuralLens } from "@/components/neural-lens/NeuralLens";
import { NotesPanel } from "@/components/knowledge/NotesPanel";
import { useGraphStore } from "@/store/useGraphStore";

/**
 * Knowledge — the same canonical graph /chat uses, opened with the
 * Knowledge lens active by default (Obsidian-style: graph-first, notes as
 * a translucent panel over it, never a separate graph). See NotesPanel for
 * the real ObsidianNote CRUD and src/lib/knowledge/wikilinks.ts for how
 * notes bridge into real KnowledgeObject/KnowledgeEdge rows on save.
 */
export default function MemoryPage() {
  const setLensCluster = useGraphStore((state) => state.setLensCluster);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [unbuiltTab, setUnbuiltTab] = useState<"memories" | "sources" | null>(null);

  useEffect(() => {
    setLensCluster("Knowledge");
  }, [setLensCluster]);

  useEffect(() => {
    const onModuleTab = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string; tabId: string }>).detail;
      if (detail?.moduleId !== "knowledge") return;

      switch (detail.tabId) {
        case "graph":
          setUnbuiltTab(null);
          setNotesCollapsed(true);
          break;
        case "documents":
          setUnbuiltTab(null);
          setNotesCollapsed(false);
          break;
        case "memories":
          setUnbuiltTab("memories");
          break;
        case "sources":
          setUnbuiltTab("sources");
          break;
      }
    };
    window.addEventListener("sentinel:module-tab", onModuleTab);
    return () => window.removeEventListener("sentinel:module-tab", onModuleTab);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050810]">
      <div className="absolute inset-0">
        <NeuralLens />
      </div>

      <NotesPanel
        collapsed={notesCollapsed}
        onToggleCollapsed={() => setNotesCollapsed((v) => !v)}
      />

      {unbuiltTab ? (
        <UnbuiltTabOverlay
          title={unbuiltTab === "memories" ? "Memories" : "Sources"}
          detail={
            unbuiltTab === "memories"
              ? "A dedicated Memories view (session/project/org-scoped memory, distinct from notes) is not built yet — real Memory rows already exist and feed the graph via chat capture."
              : "A dedicated Sources view (citations and provenance for knowledge in the graph) is not built yet."
          }
          onClose={() => setUnbuiltTab(null)}
        />
      ) : null}
    </div>
  );
}

function UnbuiltTabOverlay({ title, detail, onClose }: { title: string; detail: string; onClose: () => void }) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-3 top-0 z-30 flex w-[calc(100%-24px)] max-w-[330px] flex-col overflow-hidden rounded-xl border border-[#1a2a3c] bg-[#07111d]/88 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl xl:max-w-[376px]">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-[#dbe5f1]">{title}</h2>
        <span className="rounded border border-slate-400/25 px-1.5 py-0.5 text-[8px] text-slate-300">unavailable</span>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-[#8b93a5]">{detail}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 inline-flex w-fit rounded border border-violet-400/30 px-2.5 py-1.5 text-[10px] text-violet-200"
      >
        Back to graph
      </button>
    </div>
  );
}
