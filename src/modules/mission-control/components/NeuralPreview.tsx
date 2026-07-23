import { Bot, BrainCircuit, CheckSquare, GitBranch, Lightbulb, type LucideIcon } from "lucide-react";
import type { DataSourceState, NeuralPreviewData } from "@/lib/mission-control/types";
import { MissionPanel, PanelLink, UnavailableState } from "./MissionPanel";

const nodeStyle: Record<NeuralPreviewData["nodes"][number]["kind"], { bg: string; icon: LucideIcon }> = {
  focus: { bg: "bg-violet-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.38)]", icon: BrainCircuit },
  agent: { bg: "bg-sky-500/16 text-sky-300", icon: Bot },
  decision: { bg: "bg-amber-500/16 text-amber-300", icon: Lightbulb },
  memory: { bg: "bg-emerald-500/16 text-emerald-300", icon: GitBranch },
  task: { bg: "bg-fuchsia-500/16 text-fuchsia-300", icon: CheckSquare },
};

const positions = [
  "left-[45%] top-[40%]", "left-[13%] top-[18%]", "right-[10%] top-[15%]", "left-[12%] bottom-[14%]",
  "right-[12%] bottom-[16%]", "left-[48%] top-[8%]", "left-[49%] bottom-[7%]", "right-[31%] top-[48%]", "left-[27%] top-[49%]",
];

export function NeuralPreview({ data, sourceState }: { data: NeuralPreviewData; sourceState: DataSourceState }) {
  return (
    <MissionPanel title="Neural Space Preview" sourceState={sourceState} action={<PanelLink href="/chat?space=graph">Open Neural Space</PanelLink>} contentClassName="p-0" className="h-full">
      {data.nodes.length === 0 ? <UnavailableState source={sourceState} emptyMessage="No knowledge graph objects are available yet." /> :
      <div className="grid md:grid-cols-[150px_1fr]">
        <div className="border-b border-white/[0.07] p-4 md:border-b-0 md:border-r">
          <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#718095]">Current focus</div>
          <div className="mt-3 text-[11px] font-medium text-white">{data.project ?? "No active project"}</div>
          <div className="mt-0.5 text-[9px] text-[#8290a2]">{data.workspace ?? "No workspace"}</div>
          {data.repository ? <div className="mt-2 truncate text-[8px] text-[#718095]">{data.repository}</div> : null}
          {data.branch ? <div className="truncate text-[8px] text-violet-300">{data.branch}</div> : null}
          <dl className="mt-4 space-y-2 text-[9px]"><div className="flex justify-between"><dt className="text-[#7f8b9c]">Agents</dt><dd className="text-emerald-300">{data.activeAgentIds.length} active</dd></div><div className="flex justify-between"><dt className="text-[#7f8b9c]">Decisions</dt><dd>{data.counts.decisions}</dd></div><div className="flex justify-between"><dt className="text-[#7f8b9c]">Memories</dt><dd>{data.counts.memories}</dd></div><div className="flex justify-between"><dt className="text-[#7f8b9c]">Tasks</dt><dd>{data.counts.tasks}</dd></div><div className="flex justify-between"><dt className="text-[#7f8b9c]">Blocked</dt><dd className="text-red-300">{data.counts.blocked}</dd></div></dl>
        </div>
        <div className="relative min-h-52 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(109,74,255,0.12),transparent_52%)]">
          <svg aria-hidden className="absolute inset-0 h-full w-full opacity-55" viewBox="0 0 420 210" preserveAspectRatio="none">
            {data.edges.slice(0, 12).map((edge, index) => {
              const x1 = 210; const y1 = 100; const angle = (index / Math.max(data.edges.length, 1)) * Math.PI * 2;
              const x2 = 210 + Math.cos(angle) * 150; const y2 = 105 + Math.sin(angle) * 72;
              return <line key={`${edge.from}-${edge.to}-${index}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={index % 2 ? "#38bdf8" : "#8b5cf6"} strokeWidth="1" strokeDasharray="2 4" />;
            })}
          </svg>
          {data.nodes.slice(0, positions.length).map((node, index) => {
            const cfg = nodeStyle[node.kind]; const Icon = cfg.icon;
            return <div key={node.id} className={`absolute ${positions[index]} -translate-x-1/2 -translate-y-1/2 text-center`}><span className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] ${cfg.bg}`}><Icon className="h-3.5 w-3.5" /></span><span className="mt-1 block max-w-20 truncate text-[7px] text-[#9ca8b8]">{node.label}</span></div>;
          })}
        </div>
      </div>}
    </MissionPanel>
  );
}
