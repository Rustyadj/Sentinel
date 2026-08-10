import { AppShell } from "@/components/layout/AppShell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="h-full w-full overflow-hidden">{children}</div>
    </AppShell>
  );
}
