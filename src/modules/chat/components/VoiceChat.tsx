"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import { CANONICAL_VOICE_AGENT_IDS } from "@/lib/voice/agent-voice-config";
import { OpenAIRealtimeProvider } from "@/lib/voice/providers/openaiRealtime";
import type { VoiceStatus } from "@/lib/voice/types";
import { cn } from "@/lib/utils";

export interface VoiceChatAgent {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

/** Live voice is configured for exactly these agents; the session route refuses any other. */
export function supportsVoiceChat(agentId: string): boolean {
  return (CANONICAL_VOICE_AGENT_IDS as readonly string[]).includes(agentId);
}

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Connecting",
  listening: "Listening",
  transcribing: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Voice unavailable",
};

export function VoiceChatButton({
  agent,
  onClick,
  variant = "icon",
}: {
  agent: VoiceChatAgent | null;
  onClick: () => void;
  variant?: "icon" | "pill";
}) {
  const enabled = !!agent && supportsVoiceChat(agent.id);
  const label = enabled ? `Start voice chat with ${agent.name}` : "Voice chat is not available for this agent";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex shrink-0 items-center justify-center gap-1.5 border border-[--border] bg-[--muted] text-[--foreground] outline-none transition-colors",
        "hover:bg-[--accent] focus-visible:ring-2 focus-visible:ring-[--primary]/60 disabled:cursor-not-allowed disabled:opacity-40",
        variant === "pill" ? "rounded-lg px-2.5 py-1.5 text-xs font-medium" : "h-8 w-8 rounded-xl",
      )}
    >
      <AudioLines className={variant === "pill" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      {variant === "pill" ? <span>Voice</span> : null}
    </button>
  );
}

/**
 * Full-screen voice mode for one agent, in the manner of ChatGPT's: an orb that
 * breathes with the call state, a live caption, mute and end. Mounting starts
 * the call and unmounting ends it, so the session can never outlive the surface.
 */
export function VoiceChatOverlay({
  agent,
  roomId,
  onEnd,
}: {
  agent: VoiceChatAgent;
  /** Only pass a room that belongs to this agent; the session route rejects any other. */
  roomId?: string;
  onEnd: () => void;
}) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const providerRef = useRef<OpenAIRealtimeProvider | null>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    endRef.current?.focus();
    return () => {
      if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus();
    };
  }, []);

  useEffect(() => {
    // Built directly, not via createVoiceProvider(): that factory defaults to
    // browser speech-to-text, and this button exists to open the GPT-Live path.
    const provider = new OpenAIRealtimeProvider();
    providerRef.current = provider;
    let cancelled = false;

    provider
      .startSession({
        agentId: agent.id,
        roomId,
        onStatusChange: (next) => {
          if (!cancelled) setStatus(next);
        },
        onTranscript: (next) => {
          if (!cancelled && next.text.trim()) setCaption(next.text.trim());
        },
        onError: (reason) => {
          if (cancelled) return;
          setError(reason.message === "not-allowed" || reason.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow it in your browser and try again."
            : reason.message || "The voice session failed.");
          setStatus("error");
        },
      })
      .catch(() => undefined); // surfaced through onError

    return () => {
      cancelled = true;
      providerRef.current = null;
      void provider.stopSession();
    };
  }, [agent.id, roomId, attempt]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      providerRef.current?.setMuted(!current);
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnd]);

  const failed = status === "error";
  const connecting = status === "idle";
  const active = status === "speaking" || status === "listening" || status === "transcribing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Voice chat with ${agent.name}`}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-between bg-[--background] px-6 pb-10 pt-12"
    >
      <div className="text-center">
        <div className="text-sm font-medium text-[--foreground]">{agent.name}</div>
        <div className="mt-1 text-xs text-[--muted-foreground]" role="status" aria-live="polite">
          {failed ? STATUS_LABEL.error : muted && !connecting ? "Muted" : STATUS_LABEL[status]}
        </div>
      </div>

      <div className="flex flex-col items-center gap-8">
        <div className="relative flex h-44 w-44 items-center justify-center" aria-hidden>
          <span
            className={cn(
              "absolute inset-0 rounded-full opacity-25 transition-transform duration-500 motion-reduce:transition-none",
              status === "speaking" && "scale-110 animate-pulse motion-reduce:animate-none",
              status === "listening" && !muted && "scale-100",
              status === "thinking" && "scale-95 animate-pulse motion-reduce:animate-none",
              (failed || connecting) && "scale-90",
            )}
            style={{ backgroundColor: failed ? "#ef4444" : agent.color }}
          />
          <span
            className="absolute inset-6 rounded-full opacity-45 transition-transform duration-500 motion-reduce:transition-none"
            style={{ backgroundColor: failed ? "#ef4444" : agent.color, transform: status === "speaking" ? "scale(1.08)" : undefined }}
          />
          <span
            className="relative flex h-24 w-24 items-center justify-center rounded-full text-4xl"
            style={{ backgroundColor: failed ? "#7f1d1d" : agent.color + "55" }}
          >
            {connecting || status === "thinking" ? (
              <Loader2 className="h-8 w-8 animate-spin text-[--foreground] motion-reduce:animate-none" />
            ) : (
              agent.avatar
            )}
          </span>
        </div>

        <p
          className={cn(
            "min-h-12 max-w-md text-center text-sm leading-6",
            failed ? "text-red-300" : "text-[--muted-foreground]",
          )}
        >
          {failed ? error : caption || (active && !muted ? "Go ahead, I'm listening." : "")}
        </p>
      </div>

      <div className="flex items-center gap-5">
        {failed ? (
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setError("");
              setCaption("");
              setMuted(false);
              setAttempt((n) => n + 1);
            }}
            className="rounded-full border border-[--border] bg-[--muted] px-5 py-3 text-sm font-medium text-[--foreground] outline-none hover:bg-[--accent] focus-visible:ring-2 focus-visible:ring-[--primary]/60"
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleMute}
            disabled={connecting}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full border border-[--border] outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-[--primary]/60 disabled:opacity-40",
              muted ? "bg-[--foreground] text-[--background]" : "bg-[--muted] text-[--foreground] hover:bg-[--accent]",
            )}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
        <button
          ref={endRef}
          type="button"
          onClick={onEnd}
          aria-label="End voice chat"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white outline-none transition-colors hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
