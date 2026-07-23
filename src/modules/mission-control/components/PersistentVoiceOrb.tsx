"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AudioLines, Loader2, Mic, MicOff, X } from "lucide-react";
import { createVoiceProvider } from "@/lib/voice/providers";
import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "@/lib/voice/types";
import { sendVoiceTranscript } from "@/lib/chat/voiceBridge";
import { useKeyStore } from "@/store/useKeyStore";
import { cn } from "@/lib/utils";

const labels: Record<VoiceStatus, string> = {
  idle: "Voice ready",
  listening: "Listening",
  transcribing: "Transcribing",
  thinking: "Sentinel is thinking",
  speaking: "Sentinel is speaking",
  error: "Voice needs attention",
};

interface PersistentVoiceOrbProps {
  providerFactory?: () => VoiceProvider;
  submitTranscript?: (text: string) => Promise<string>;
}

export function PersistentVoiceOrb({ providerFactory = createVoiceProvider, submitTranscript }: PersistentVoiceOrbProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const providerRef = useRef<VoiceProvider | null>(null);
  const keys = useKeyStore();
  const active = status !== "idle" && status !== "error";

  const submit = useCallback(async (text: string) => {
    setStatus("thinking");
    try {
      const answer = await (submitTranscript?.(text) ?? sendVoiceTranscript(text, keys));
      setResponse(answer || "Sentinel received your request in Mission Control chat.");
      setStatus("speaking");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Voice request failed");
      setStatus("error");
    }
  }, [keys, submitTranscript]);

  const start = async () => {
    if (active) {
      await providerRef.current?.stopSession();
      providerRef.current = null;
      setStatus("idle");
      return;
    }
    setOpen(true);
    setError("");
    setResponse("");
    const provider = providerFactory();
    providerRef.current = provider;
    const config: VoiceProviderConfig = {
      agentId: "hermes-lisa",
      onStatusChange: (next) => setStatus(next),
      onTranscript: (next) => {
        setTranscript(next.text);
        if (next.isFinal) void submit(next.text);
      },
      onError: (reason) => {
        setError(reason.message === "not-allowed" ? "Microphone permission denied" : reason.message);
        setStatus("error");
      },
    };
    try {
      await provider.startSession(config);
    } catch (reason) {
      config.onError?.(reason instanceof Error ? reason : new Error("Voice provider failed"));
    }
  };

  const wave = status === "listening" || status === "speaking";
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex items-end gap-2 sm:bottom-5 sm:right-5">
      {open ? (
        <div className="w-[min(310px,calc(100vw-88px))] rounded-xl border border-[#2a3342] bg-[#101821]/98 p-3 text-white shadow-[0_18px_55px_rgba(2,6,23,0.38)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold">{labels[status]}</span><button type="button" onClick={() => setOpen(false)} aria-label="Close voice status" className="flex h-7 w-7 items-center justify-center rounded text-[#8290a2] outline-none hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/60"><X className="h-3.5 w-3.5" /></button></div>
          <div className="mt-2 flex h-5 items-center gap-[3px]" aria-hidden>{Array.from({ length: 12 }, (_, index) => <span key={index} className={cn("w-[2px] rounded-full", wave ? "animate-wave-bar bg-violet-300" : "h-1 bg-[#465264]")} style={wave ? { animationDelay: `${index * -75}ms` } : undefined} />)}</div>
          <p className={cn("mt-2 min-h-8 text-[9px] leading-4", error ? "text-red-300" : "text-[#9eabba]")}>{error || response || transcript || "Use the orb to talk to Hermes through the existing Mission Control chat."}</p>
          <Link href="/chat" className="mt-2 inline-flex text-[9px] font-medium text-violet-300 outline-none hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400/60">Open conversation</Link>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void start()}
        aria-label={active ? "Stop voice session" : "Start voice session"}
        aria-expanded={open}
        aria-pressed={active}
        className={cn(
          "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border bg-[#111a25] text-violet-200 shadow-[0_10px_35px_rgba(15,23,42,0.34)] outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-violet-400/70 motion-reduce:transform-none",
          status === "error" ? "border-red-400/60 text-red-300" : "border-violet-400/45"
        )}
      >
        <span className="absolute inset-1 rounded-full border border-white/[0.07]" />
        {status === "thinking" || status === "transcribing" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : status === "speaking" ? <AudioLines className="h-4 w-4" /> : active ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        <span className={cn("absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-[#111a25]", status === "error" ? "bg-red-400" : active ? "bg-emerald-400" : "bg-slate-500")} />
      </button>
    </div>
  );
}
