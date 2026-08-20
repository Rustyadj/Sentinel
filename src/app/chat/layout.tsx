import { AppShell } from "@/components/layout/AppShell";

// CollaborationRoom owns its right-hand lane. AppShell still owns the global
// navigation rail and module tabs, preserving the rest of Sentinel's shell.
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <AppShell rightPanel={false}>{children}</AppShell>;
}
