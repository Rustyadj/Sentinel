import { AppShell } from "@/components/layout/AppShell";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <AppShell rightPanel={false}>{children}</AppShell>;
}
