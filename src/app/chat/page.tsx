"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useGraphStore } from "@/store/useGraphStore";
import { ChatPanel } from "@/components/chat/ChatPanel";
import {
  KnowledgeGraph,
  type GraphData,
  type GraphSource,
} from "@/components/graph/KnowledgeGraph";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { NodeInspector } from "@/components/graph/NodeInspector";
import { StatusBar } from "@/components/layout/StatusBar";
import type { KnowledgeNode } from "@/lib/knowledge/types";
import type { VoiceStatus } from "@/lib/voice/types";

/**
 * Chat — the Sentinel OS operating surface.
 *
 * The knowledge graph is the primary canvas; the chat panel floats over it as
 * translucent glass on the left. All data flow lives in useChatSession; graph
 * UI state lives in useGraphStore.
 */
export default function ChatPage() {
  const session = useChatSession();
  const { requestFocus, requestFit } = useGraphStore();

  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [graphSource, setGraphSource] = useState<GraphSource>("demo");

  const activeAgent = session.roomAgents[0];

  // Ctrl/Cmd+G toggles the chat panel so the graph can go nearly full-screen
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setChatCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Module tabs control meaningful canvas states instead of acting as inert
  // decoration. Additional module surfaces can subscribe to the same event.
  useEffect(() => {
    const onModuleTab = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string; tabId: string }>).detail;
      if (detail?.moduleId !== "chat") return;

      switch (detail.tabId) {
        case "mission":
          setChatCollapsed(false);
          requestFit();
          break;
        case "graph":
          setChatCollapsed(true);
          requestFit();
          break;
        case "conversation":
          setChatCollapsed(false);
          setMobileChatOpen(true);
          break;
        case "sources":
          setChatCollapsed(true);
          requestFocus("Audience Research");
          break;
        case "workflows":
          setChatCollapsed(true);
          requestFocus("Workflows");
          break;
      }
    };

    window.addEventListener("sentinel:module-tab", onModuleTab);
    return () => window.removeEventListener("sentinel:module-tab", onModuleTab);
  }, [requestFit, requestFocus]);

  const handleGraphData = useCallback((data: GraphData, source: GraphSource) => {
    setGraphData(data);
    setGraphSource(source);
  }, []);

  // Referenced entity in a message → animate/focus the relevant graph cluster
  const handleReference = useCallback(
    (title: string) => {
      requestFocus(title);
    },
    [requestFocus]
  );

  // Node → chat: push node context into the composer
  const handleSendNodeToChat = useCallback(
    (node: KnowledgeNode) => {
      session.setInput(
        session.input.trim()
          ? `${session.input} [[${node.title}]] `
          : `Using [[${node.title}]] (${node.type}): `
      );
      setChatCollapsed(false);
      setMobileChatOpen(true);
    },
    [session]
  );

  const nodeTypes = useMemo(
    () => Array.from(new Set(graphData.nodes.map((n) => n.type))).sort(),
    [graphData.nodes]
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050810]">
      {/* Primary canvas — the knowledge graph */}
      <div className="absolute inset-0">
        <KnowledgeGraph
          roomId={session.activeRoomId ?? undefined}
          projectId={session.activeRoom?.projectId}
          isStreaming={session.isStreaming}
          refreshKey={session.graphRefreshKey}
          onDataChange={handleGraphData}
        />
      </div>

      <GraphToolbar nodeTypes={nodeTypes} onFit={requestFit} />

      <NodeInspector
        nodes={graphData.nodes}
        edges={graphData.edges}
        onSendToChat={handleSendNodeToChat}
      />

      {/* Chat panel — glass overlay on desktop, drawer on small screens */}
      <div className="hidden lg:block">
        <ChatPanel
          session={session}
          collapsed={chatCollapsed}
          onToggleCollapsed={() => setChatCollapsed((v) => !v)}
          onVoiceStatusChange={setVoiceStatus}
          onReference={handleReference}
        />
      </div>

      {/* Small screens: floating toggle + overlay drawer */}
      <div className="lg:hidden">
        {mobileChatOpen ? (
          <>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setMobileChatOpen(false)}
              className="absolute inset-0 z-20 bg-black/40"
            />
            <ChatPanel
              session={session}
              collapsed={false}
              onToggleCollapsed={() => setMobileChatOpen(false)}
              onVoiceStatusChange={setVoiceStatus}
              onReference={(title) => {
                handleReference(title);
                setMobileChatOpen(false);
              }}
            />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMobileChatOpen(true)}
            aria-label="Open chat"
            className="absolute bottom-12 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-[#0b0f17]/85 text-[#c8cdd8] shadow-2xl outline-none backdrop-blur-xl transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-indigo-400/60"
          >
            <MessageSquare className="h-4 w-4" />
            {(session.isThinking || session.isStreaming) && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse-dot rounded-full bg-amber-400" />
            )}
          </button>
        )}
      </div>

      <StatusBar
        nodeCount={graphData.nodes.length}
        edgeCount={graphData.edges.length}
        graphSource={graphSource}
        isStreaming={session.isStreaming || session.isThinking}
        voiceStatus={voiceStatus}
        activeAgentName={activeAgent?.name}
      />
    </div>
  );
}
