"use client";

import { AlertTriangle, Check, Eye, GitCompareArrows, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollaborationApproval } from "@/store/useCollaborationStore";
import type { AgentDisagreement, CollaborationParticipant } from "@/types/collaboration";

export function DisagreementCard({
  disagreement,
  participants,
  onChoose,
  onAskLead,
}: {
  disagreement: AgentDisagreement;
  participants: CollaborationParticipant[];
  onChoose: (agentId: string) => void;
  onAskLead: () => void;
}) {
  const positions = disagreement.positions.slice(0, 2);
  if (disagreement.finalDecision) {
    return (
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.045] p-3 text-[11px] text-emerald-100/85">
        <div className="flex items-center gap-2 font-medium"><Check className="h-3.5 w-3.5" /> Disagreement resolved</div>
        <p className="mt-1.5 leading-relaxed text-[#afc9bd]">{disagreement.finalDecision}</p>
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-amber-400/25 bg-amber-400/[0.045] p-3.5" aria-label="Agent disagreement">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Agent disagreement <span className="ml-auto rounded border border-amber-300/15 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.14em] text-amber-200/65">{disagreement.severity}</span></div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#c9d2dd]">{disagreement.issue}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {positions.map((position) => {
          const participant = participants.find((item) => item.agentId === position.agentId);
          return (
            <div key={position.agentId} className="rounded-lg border border-white/[0.07] bg-black/15 p-2.5">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#9fb0c2]">{participant?.name ?? position.agentId}</div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-[#bec9d5]">{position.position}</p>
              {position.evidence ? <p className="mt-2 border-t border-white/[0.06] pt-2 text-[9.5px] leading-relaxed text-[#718399]">{position.evidence}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <CardButton icon={GitCompareArrows} label="Compare Reasoning" />
        <CardButton icon={ShieldAlert} label="Ask Hermes" onClick={onAskLead} />
        {positions.map((position) => <CardButton key={position.agentId} icon={Check} label={`Choose ${participants.find((item) => item.agentId === position.agentId)?.name ?? position.agentId}`} onClick={() => onChoose(position.agentId)} />)}
      </div>
    </section>
  );
}

export function ApprovalCard({ approval, onApprove, onDeny, onInspect }: { approval: CollaborationApproval; onApprove: () => void; onDeny: () => void; onInspect: () => void }) {
  const complete = approval.status !== "pending";
  return (
    <section className={cn("rounded-xl border p-3.5", complete ? "border-white/[0.07] bg-white/[0.025]" : "border-violet-400/25 bg-violet-400/[0.05]")} aria-label={`Approval ${approval.title}`}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200"><ShieldAlert className="h-3.5 w-3.5" /> Approval required <span className="ml-auto text-[9px] normal-case tracking-normal text-[#8191a5]">{approval.status}</span></div>
      <div className="mt-2 text-[11.5px] font-medium text-[#e6edf4]">{approval.title}</div>
      <dl className="mt-2 grid gap-1.5 text-[9.5px] sm:grid-cols-3">
        <div><dt className="text-[#617187]">Command</dt><dd className="mt-0.5 break-all font-mono text-[#b7c4d2]">{approval.command}</dd></div>
        <div><dt className="text-[#617187]">Environment</dt><dd className="mt-0.5 text-[#b7c4d2]">{approval.environment}</dd></div>
        <div><dt className="text-[#617187]">Risk</dt><dd className={cn("mt-0.5 capitalize", approval.risk === "high" ? "text-red-300" : approval.risk === "medium" ? "text-amber-300" : "text-emerald-300")}>{approval.risk}</dd></div>
      </dl>
      {!complete ? <div className="mt-3 flex gap-1.5"><CardButton icon={Check} label="Approve" onClick={onApprove} emphasis /><CardButton icon={X} label="Deny" onClick={onDeny} /><CardButton icon={Eye} label="Inspect" onClick={onInspect} /></div> : null}
    </section>
  );
}

function CardButton({ icon: Icon, label, onClick, emphasis = false }: { icon: typeof Check; label: string; onClick?: () => void; emphasis?: boolean }) {
  return <button type="button" onClick={onClick} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50", emphasis ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15" : "border-white/[0.08] bg-black/15 text-[#9eacbc] hover:border-white/15 hover:text-white")}><Icon className="h-3 w-3" />{label}</button>;
}
