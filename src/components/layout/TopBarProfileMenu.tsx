"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Settings } from "lucide-react";

interface TopBarProfileMenuProps {
  initials: string;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Open state is controlled by TopBar so only one top-bar menu is open at
 * a time. */
export function TopBarProfileMenu({ initials, displayName, open, onOpenChange }: TopBarProfileMenuProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="Open user menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.09] bg-[#111c29] text-[9px] font-semibold text-[#dbe5f1] outline-none transition-colors hover:border-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400/55"
      >
        {initials}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a1420]/98 py-1 shadow-2xl"
        >
          <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] text-[#dbe5f1]">
            <div className="truncate font-medium">{displayName}</div>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-[11px] text-[#c5cedb] hover:bg-white/[0.05]"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] text-[#e39a9a] hover:bg-white/[0.05]"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
