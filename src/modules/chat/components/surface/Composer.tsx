"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Paperclip, Plus, Wrench, FolderOpen, HardDrive, Link2, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComposerAction {
  id: string;
  label: string;
  icon: "attach" | "project" | "workspace" | "context" | "tool" | "source";
  /** Absent means the capability is not wired up on this deployment yet. */
  onSelect?: () => void;
  unavailableReason?: string;
}

const ACTION_ICONS = {
  attach: Paperclip, project: FolderOpen, workspace: HardDrive,
  context: Link2, tool: Wrench, source: Link2,
} as const;

/**
 * One input, one send button, and a "+" that reveals everything else. The
 * composer never shows a dozen permanent controls.
 */
export function Composer({ value, onChange, onSend, disabled, busy, placeholder, actions, onVoice }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder: string;
  actions: ComposerAction[];
  onVoice?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to a ceiling, then scroll.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled && !busy;

  return (
    <div className="relative mx-auto w-full max-w-[52rem] px-4 pb-5">
      {menuOpen ? (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
          <div className="absolute bottom-[calc(100%-0.25rem)] left-4 z-20 w-64 overflow-hidden rounded-xl bg-[--card] py-1 shadow-[var(--shadow-lg)]">
            {actions.map((action) => {
              const Icon = ACTION_ICONS[action.icon];
              const available = Boolean(action.onSelect);
              return (
                <button
                  key={action.id}
                  disabled={!available}
                  title={action.unavailableReason}
                  onClick={() => { action.onSelect?.(); setMenuOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-[14px]",
                    available ? "text-[--foreground] hover:bg-[--muted]" : "cursor-not-allowed text-[--muted-foreground]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{action.label}</span>
                  {!available ? <span className="text-[11px]">unavailable</span> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="flex items-end gap-2 rounded-2xl bg-[--card] p-2 shadow-[var(--shadow-md)]">
        <button
          type="button"
          aria-label="Add attachment, context or tool"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[--muted-foreground] transition-colors hover:bg-[--muted] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) onSend(); }
          }}
          className="max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-[1.6] text-[--foreground] outline-none placeholder:text-[--muted-foreground] disabled:opacity-60"
        />

        {onVoice ? (
          <button
            type="button"
            aria-label="Voice input"
            onClick={onVoice}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[--muted-foreground] transition-colors hover:bg-[--muted] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
          >
            <Mic className="h-[18px] w-[18px]" />
          </button>
        ) : null}

        <button
          type="button"
          aria-label="Send message"
          disabled={!canSend}
          onClick={onSend}
          className={cn(
            "mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]",
            canSend ? "bg-[--primary] text-[--primary-foreground]" : "bg-[--muted] text-[--muted-foreground]",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
        </button>
      </div>
    </div>
  );
}
