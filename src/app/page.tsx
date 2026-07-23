import { AppShell } from "@/components/layout/AppShell";
import { MissionControlPage } from "@/modules/mission-control";

export default function HomePage() {
  return (
    <AppShell rightPanel={false}>
      <MissionControlPage />
    </AppShell>
  );
}
