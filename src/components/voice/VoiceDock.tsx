"use client";

import { useState, useCallback, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceProvider, VoiceStatus } from "@/lib/voice/types";

interface VoiceDockProps {
  agentId?: string;
  onTranscript: (text: string) => void;
}

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: "Idle",
  listening: "Listening...",
  transcribing: "Transcribing",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

const STATUS_PILL_STYLES: Record<VoiceStatus, string> = {
  idle: "bg-[--muted] text-[--muted-foreground]",
  listening: "bg-red-500/20 text-red-400 animate-pulse",
  transcribing: "bg-amber-500/20 text-amber-400",
  thinking: "bg-blue-500/20 text-blue-400",
  speaking: "bg-emerald-500/20 text-emerald-400",
  error: "bg-[--destructive]/20 text-[--destructive]",
};

export function VoiceDock({ agentId, onTranscript }: VoiceDockProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const providerRef = useRef<VoiceProvider | null>(null);
  const isActive = status !== "idle" && status !== "error";

  const handleToggle = useCallback(async () => {
    // Stop if already active
    if (isActive) {
      await providerRef.current?.stopSession();
      providerRef.current = null;
      setStatus("idle");
      setTranscript("");
      return;
    }

    // Lazily create provider on first use (client-side only)
    if (!providerRef.current) {
      const { createVoiceProvider } = await import("@/lib/voice/providers/index");
      providerRef.current = createVoiceProvider();
    }

    setPermissionError(null);
    setTranscript("");

    await providerRef.current.startSession({
      agentId,
      onStatusChange: (s) => setStatus(s),
      onTranscript: (t) => {
        setTranscript(t.text);
        if (t.isFinal) {
          onTranscript(t.text);
        }
      },
      onError: (err) => {
        if (err.message === "not-allowed") {
          setPermissionError("Microphone permission denied");
        } else {
          setPermissionError(err.message);
        }
        setStatus("error");
      },
    });
  }, [isActive, agentId, onTranscript]);

  return (
    <div className="flex items-center gap-2 py-1.5">
      {/* Mic button */}
      <button
        onClick={handleToggle}
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded-md transition-all shrink-0",
          status === "idle" &&
            "text-[--muted-foreground] hover:text-[--foreground] hover:bg-[--muted]",
          status === "listening" &&
            "bg-red-500 text-white animate-pulse",
          status === "transcribing" &&
            "bg-amber-500/20 text-amber-400",
          status === "thinking" &&
            "bg-blue-500/20 text-blue-400",
          status === "speaking" &&
            "bg-emerald-500/20 text-emerald-400",
          status === "error" &&
            "border border-[--destructive] text-[--destructive]"
        )}
        title={isActive ? "Stop voice" : "Start voice input"}
        aria-label={isActive ? "Stop voice input" : "Start voice input"}
      >
        {status === "transcribing" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isActive ? (
          <MicOff className="w-3.5 h-3.5" />
        ) : (
          <Mic className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Status badge */}
      <span
        className={cn(
          "text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
          STATUS_PILL_STYLES[status]
        )}
      >
        {STATUS_LABELS[status]}
      </span>

      {/* Transcript preview or permission error */}
      {permissionError ? (
        <span className="text-[11px] text-[--destructive] truncate italic">
          {permissionError}
        </span>
      ) : transcript ? (
        <span className="text-[11px] text-[--muted-foreground] truncate italic">
          {transcript}
        </span>
      ) : null}
    </div>
  );
}
