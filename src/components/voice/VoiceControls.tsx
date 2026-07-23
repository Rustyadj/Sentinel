"use client";

import { useCallback, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceProvider, VoiceStatus } from "@/lib/voice/types";

interface VoiceControlsProps {
  agentId?: string;
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
 * provider factory (browser STT / mock).
 */
export function VoiceControls({ agentId, onTranscript, onStatusChange }: VoiceControlsProps) {
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
    });
  }, [isActive, agentId, onStatusChange, onTranscript]);

  return (
    <div className="flex min-w-0 items-center gap-2" aria-live="polite">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={isActive ? "Stop voice input" : "Start voice input"}
        aria-pressed={isActive}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400/60",
          status === "idle" && "text-[#697084] hover:bg-white/[0.06] hover:text-[#c8cdd8]",
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
          waveActive ? "opacity-100" : "opacity-25"
        )}
      >
        {Array.from({ length: WAVE_BARS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] rounded-full",
              waveActive ? "animate-wave-bar bg-emerald-400/80" : "h-[3px] bg-[#3a3f50]"
            )}
            style={waveActive ? { animationDelay: `${i * -80}ms` } : undefined}
          />
        ))}
      </div>

      <span className="min-w-0 truncate text-[10px] text-[#697084]">
        {error ?? (transcript || STATUS_LABELS[status])}
      </span>
    </div>
  );
}
