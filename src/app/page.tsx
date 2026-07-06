"use client";

import { useState, useCallback } from "react";
import { MessageSquare, GitFork } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HomeChat } from "@/components/home/HomeChat";
import { LiveKnowledgeGraph } from "@/components/home/LiveKnowledgeGraph";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [mobilePane, setMobilePane] = useState<"chat" | "graph">("chat");

  const handleStreamEnd = useCallback(() => {
    // Give extraction a beat to persist before refetching the graph
    setTimeout(() => setGraphRefreshKey((k) => k + 1), 600);
  }, []);

  return (
    <AppShell showRightPanel={false}>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Mobile pane switcher */}
        <div className="flex shrink-0 gap-1 border-b border-[--border] px-4 py-2 lg:hidden">
          {(
            [
              { id: "chat", label: "Chat", icon: MessageSquare },
              { id: "graph", label: "Graph", icon: GitFork },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMobilePane(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                mobilePane === id
                  ? "bg-[--primary]/15 text-[--primary]"
                  : "text-[--muted-foreground] hover:text-[--foreground]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section
            className={cn(
              "min-w-0 flex-1",
              mobilePane === "chat" ? "flex" : "hidden lg:flex"
            )}
          >
            <HomeChat
              onStreamingChange={setIsStreaming}
              onStreamEnd={handleStreamEnd}
            />
          </section>

          <section
            className={cn(
              "border-l border-[--border]",
              "lg:block lg:w-[44%] lg:max-w-[720px]",
              mobilePane === "graph" ? "block w-full" : "hidden"
            )}
          >
            <LiveKnowledgeGraph
              isStreaming={isStreaming}
              refreshKey={graphRefreshKey}
            />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
