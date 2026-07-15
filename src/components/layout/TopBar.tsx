"use client";

import Link from "next/link";
import { Search, Bell, Lightbulb, MessageSquare, ChevronDown, Cpu } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/store/useAppStore";
import { useRouter } from "next/navigation";

export function TopBar() {
  const router = useRouter();
  const { setCommandBarOpen } = useAppStore();
  const { data: session } = useSession();

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <header className="h-14 shrink-0 z-50 border-b border-[--border] bg-[--sidebar] flex items-center px-3 gap-3">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2.5 shrink-0 pl-1 pr-2">
        <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-[--primary]/15">
          <Cpu className="w-4 h-4 text-[--primary]" />
        </div>
        <div className="hidden sm:flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tracking-tight text-[--foreground]">
            Sentinel
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[--muted-foreground]">
            OS
          </span>
        </div>
      </Link>

      {/* Command search — centered */}
      <button
        onClick={() => setCommandBarOpen(true)}
        className="flex-1 max-w-xl mx-auto flex items-center gap-2.5 h-9 px-3.5 rounded-lg border border-[--border] bg-[--muted]/60 text-[--muted-foreground] text-sm hover:border-[--primary]/40 hover:bg-[--muted] transition-colors"
      >
        <Search className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">Search Sentinel OS…</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[--border] px-1.5 py-0.5 font-mono text-[10px] text-[--muted-foreground]">
          ⌘K
        </kbd>
      </button>

      {/* Right cluster */}
      <div className="flex items-center gap-1 shrink-0">
        <IconButton title="Tips">
          <Lightbulb className="w-4 h-4" />
        </IconButton>
        <IconButton title="Messages" onClick={() => router.push("/chat")}>
          <MessageSquare className="w-4 h-4" />
        </IconButton>
        <IconButton title="Notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[--primary]" />
        </IconButton>

        <span className="w-px h-6 bg-[--border] mx-1.5" />

        <button
          onClick={() => router.push("/settings")}
          className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-[--accent] transition-colors"
          title="Account"
        >
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? "User"}
              className="w-7 h-7 rounded-full border border-[--border] object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[--primary]/20 flex items-center justify-center text-[11px] text-[--primary] font-semibold">
              {initials}
            </div>
          )}
          <div className="hidden md:flex flex-col items-start leading-tight">
            <span className="text-xs font-medium text-[--foreground]">
              {user?.name?.split(" ")[0] ?? "User"}
            </span>
            <span className="text-[10px] text-[--muted-foreground]">Administrator</span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-[--muted-foreground] hidden md:block" />
        </button>
      </div>
    </header>
  );
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="relative h-8 w-8 flex items-center justify-center rounded-lg text-[--muted-foreground] hover:text-[--foreground] hover:bg-[--accent] transition-colors"
    >
      {children}
    </button>
  );
}
