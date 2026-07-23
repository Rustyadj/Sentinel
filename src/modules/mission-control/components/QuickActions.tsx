import { AudioLines, Bot, CheckSquare, FolderPlus, MessageSquarePlus, PackagePlus, ShieldCheck, UserPlus, type LucideIcon } from "lucide-react";
import type { QuickAction } from "@/lib/mission-control/types";
import { MissionPanel } from "./MissionPanel";

const icons: Record<QuickAction["icon"], LucideIcon> = { project: FolderPlus, chat: MessageSquarePlus, voice: AudioLines, task: CheckSquare, invite: UserPlus, studio: Bot, module: PackagePlus, approval: ShieldCheck };

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <MissionPanel title="Quick Actions" contentClassName="p-2.5" className="h-full">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        {actions.map((action) => { const Icon = icons[action.icon]; return <a key={action.id} href={action.href} className="flex min-h-12 items-center gap-2 rounded-md border border-white/[0.1] bg-white/[0.025] px-3 text-[9px] font-medium text-[#d6dde8] outline-none hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/60"><Icon className="h-4 w-4 shrink-0 text-violet-300" />{action.label}</a>; })}
      </div>
    </MissionPanel>
  );
}
