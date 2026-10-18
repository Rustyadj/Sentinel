import { requireUser } from "@/lib/current-user";
import { SystemOnePanel } from "@/modules/mission-control/components/SystemOnePanel";
export const metadata = { title: "Jev System-1 · Sentinel" };
export default async function Page() { await requireUser(); return <SystemOnePanel />; }
