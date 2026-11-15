"use client";

import { useCallback, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceProvider, VoiceStatus } from "@/lib/voice/types";

interface VoiceControlsProps {
  /**
   * Required. Which agent is speaking is never inferred: an optional agentId
   * meant a surface that forgot to pass one opened a session in Lisa's voice,
   * with Lisa's instructions, in whatever conversation was open. Making it
   * required turns that into a compile error instead of a silent identity
   * swap at runtime.
   */
  agentId: string;
  /** Keep the global microphone touch-sized without crowding a narrow header. */
  compactOnMobile?: boolean;
  /** Required by LiveKitVoiceProvider to scope the voice session's token to a real conversation. */
  roomId?: string;
  onTranscript: (text: string) => void;
  onStatusChange?: (status: VoiceStatus) => void;
}

const WAVE_BARS = 14;

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: "Voice ready",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Voice error",
};

/**
 * Mic toggle + live waveform. The waveform animates only while listening or
 * speaking; transcription state shows a spinner. Uses the existing voice
 * configured voice provider.
 */
export function VoiceControls({ agentId, roomId, compactOnMobile = false, onTranscript, onStatusChange }: VoiceControlsProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<VoiceProvider | null>(null);

  const isActive = status !== "idle" && status !== "error";
  const waveActive = status === "listening" || status === "speaking";

  const handleToggle = useCallback(async () => {
    if (isActive) {
      await providerRef.current?.stopSession();
      providerRef.current = null;
      setStatus("idle");
      setTranscript("");
      onStatusChange?.("idle");
      return;
    }

    if (!providerRef.current) {
      const { createVoiceProvider } = await import("@/lib/voice/providers/index");
      providerRef.current = createVoiceProvider();
    }

    setError(null);
    setTranscript("");

    await providerRef.current.startSession({
      agentId,
      roomId,
      onStatusChange: (s) => {
        setStatus(s);
        onStatusChange?.(s);
      },
      onTranscript: (t) => {
        setTranscript(t.text);
        if (t.isFinal) onTranscript(t.text);
      },
      onError: (err) => {
        setError(
          err.message === "not-allowed" ? "Microphone permission denied" : err.message
        );
        setStatus("error");
        onStatusChange?.("error");
      },
    }).catch((reason: unknown) => {
      // Some providers report onError and then reject; keep a denied mobile
      // microphone request in the control rather than an unhandled rejection.
      const message = reason instanceof Error ? reason.message : "Voice could not start";
      setError(message === "not-allowed" ? "Microphone permission denied" : message);
      setStatus("error");
      onStatusChange?.("error");
    });
  }, [isActive, agentId, roomId, onStatusChange, onTranscript]);

  return (
    <div className="relative flex min-w-0 items-center gap-2" aria-live="polite">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={isActive ? "Stop voice input" : "Start voice input"}
        aria-pressed={isActive}
        title={error ?? (isActive ? "Stop voice chat" : "Start voice chat")}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400/60",
          compactOnMobile && "h-11 w-11 xl:h-7 xl:w-7",
          status === "idle" && "text-(--muted-foreground) hover:bg-white/[0.06] hover:text-(--foreground)",
          status === "listening" && "bg-emerald-500/15 text-emerald-400",
          status === "transcribing" && "bg-amber-500/15 text-amber-400",
          status === "thinking" && "bg-violet-500/15 text-violet-400",
          status === "speaking" && "bg-emerald-500/15 text-emerald-400",
          status === "error" && "bg-red-500/10 text-red-400"
        )}
      >
        {status === "transcribing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isActive ? (
          <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Waveform — animates only while listening/speaking */}
      <div
        aria-hidden
        className={cn(
          "flex h-5 items-center gap-[2px] overflow-hidden transition-opacity",
          compactOnMobile && "hidden xl:flex",
          waveActive ? "opacity-100" : "opacity-25"
        )}
      >
        {Array.from({ length: WAVE_BARS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] rounded-full",
              waveActive ? "animate-wave-bar bg-emerald-400/80" : "h-[3px] bg-(--text-faint)"
            )}
            style={waveActive ? { animationDelay: `${i * -80}ms` } : undefined}
          />
        ))}
      </div>

      <span className={cn(
        "min-w-0 truncate text-[10px] text-(--muted-foreground)",
        compactOnMobile && "sr-only xl:not-sr-only",
      )}>
        {error ?? (transcript || STATUS_LABELS[status])}
      </span>
      {compactOnMobile && error ? (
        <span role="alert" className="absolute right-0 top-full z-50 mt-2 w-max max-w-[calc(100vw-2rem)] whitespace-normal rounded-md border border-(--border) bg-(--popover) px-3 py-2 text-xs text-(--foreground) shadow-lg xl:hidden">
          {error}
        </span>
      ) : null}
    </div>
  );
}
