"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
  Panel,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Save, Trash2, Users, Bot, Building2, X, Check,
  UserPlus, Mail, Clock, ChevronDown,
  Shield, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SYSTEM_ROLES } from "@/lib/org/types";
import { createInvite, listInvites, revokeInvite } from "@/lib/org/inviteService";
import type { OrgInvite } from "@/lib/org/types";
import type { CreateInviteInput } from "@/lib/org/inviteService";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = "org-1";
const SELF_MEMBER_ID = "member-1";

const WORKSPACES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "chat", label: "Chat" },
  { id: "builder", label: "AI Studio" },
  { id: "workflows", label: "Workflows" },
  { id: "kanban", label: "Kanban" },
  { id: "memory", label: "Memory" },
  { id: "obsidian", label: "Knowledge" },
  { id: "orgchart", label: "Organization" },
  { id: "security", label: "Security" },
];

const DEPARTMENTS = [
  { id: "dept-eng", name: "Engineering" },
  { id: "dept-ops", name: "Operations" },
  { id: "dept-design", name: "Design" },
  { id: "dept-sales", name: "Sales" },
  { id: "dept-exec", name: "Executive" },
];

const AGENT_TEAMS = [
  { id: "team-alpha", name: "Alpha — General purpose" },
  { id: "team-build", name: "Build — AI Studio agents" },
  { id: "team-ops", name: "Ops — Workflow agents" },
];

// ─── Node types ───────────────────────────────────────────────────────────────

function PersonNode({ data, selected }: { data: Record<string, string>; selected: boolean }) {
  return (
    <div className={cn(
      "bg-[#161920] border rounded-xl p-3 min-w-[160px] shadow-lg transition-all",
      selected ? "border-indigo-500 shadow-indigo-500/20" : "border-[#1e2130]"
    )}>
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg bg-indigo-500/10 border border-indigo-500/20 shrink-0">
          {data.avatar ?? "👤"}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#e2e5ed] truncate">{data.label}</div>
          <div className="text-[11px] text-[#7a8099] truncate">{data.title ?? "Team Member"}</div>
        </div>
      </div>
      {data.department && (
        <div className="mt-2 text-[10px] text-indigo-400 bg-indigo-500/10 rounded-md px-2 py-0.5 inline-block">
          {data.department}
        </div>
      )}
    </div>
  );
}

function AgentNode({ data, selected }: { data: Record<string, string>; selected: boolean }) {
  const statusColor: Record<string, string> = {
    online: "#10B981", busy: "#F59E0B", idle: "#64748B", offline: "#EF4444",
  };
  return (
    <div className={cn(
      "bg-[#161920] border rounded-xl p-3 min-w-[160px] shadow-lg transition-all",
      selected ? "border-violet-500 shadow-violet-500/20" : "border-[#1e2130]"
    )}>
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg bg-violet-500/10 border border-violet-500/20">
            {data.avatar ?? "🤖"}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#161920]"
            style={{ background: statusColor[data.status] ?? "#64748B" }}
          />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#e2e5ed] truncate">{data.label}</div>
          <div className="text-[11px] text-[#7a8099] truncate">{data.role ?? "AI Agent"}</div>
        </div>
      </div>
      {data.model && (
        <div className="mt-2 text-[10px] text-violet-400 bg-violet-500/10 rounded-md px-2 py-0.5 inline-block">
          {data.model}
        </div>
      )}
    </div>
  );
}

function DepartmentNode({ data, selected }: { data: Record<string, string>; selected: boolean }) {
  return (
    <div className={cn(
      "bg-[#161920] border-2 border-dashed rounded-2xl px-5 py-3 min-w-[200px] shadow-lg transition-all",
      selected ? "border-cyan-500" : "border-[#2a2f40]"
    )}>
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-cyan-400 shrink-0" />
        <div className="text-sm font-bold text-[#e2e5ed]">{data.label}</div>
      </div>
      {data.description && (
        <div className="text-[11px] text-[#7a8099] mt-1">{data.description}</div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  person: PersonNode as never,
  agent: AgentNode as never,
  department: DepartmentNode as never,
};

// ─── Default chart data ──────────────────────────────────────────────────────

const DEFAULT_NODES: Node[] = [
  { id: "dept-1", type: "department", position: { x: 300, y: 20 }, data: { label: "Leadership", description: "Executive team" } },
  { id: "person-1", type: "person", position: { x: 350, y: 130 }, data: { label: "Cash", title: "CEO", avatar: "👔", department: "Executive" } },
  { id: "agent-1", type: "agent", position: { x: 120, y: 260 }, data: { label: "Hermes Lisa", role: "Chief Orchestrator", avatar: "🌸", model: "claude-sonnet-4-6", status: "online" } },
  { id: "agent-2", type: "agent", position: { x: 380, y: 260 }, data: { label: "Hermes Clint", role: "ICF Specialist", avatar: "🏗️", model: "claude-sonnet-4-6", status: "online" } },
  { id: "agent-3", type: "agent", position: { x: 620, y: 260 }, data: { label: "OpenClaw", role: "Research Agent", avatar: "🔍", model: "claude-opus-4-8", status: "idle" } },
];

const DEFAULT_EDGES: Edge[] = [
  { id: "e1", source: "person-1", target: "agent-1", markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "#3a3f50" } },
  { id: "e2", source: "person-1", target: "agent-2", markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "#3a3f50" } },
  { id: "e3", source: "person-1", target: "agent-3", markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "#3a3f50" } },
];

// ─── Node edit panel ─────────────────────────────────────────────────────────

function EditPanel({ node, onUpdate, onDelete, onClose }: {
  node: Node;
  onUpdate: (id: string, data: Record<string, string>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(node.data as Record<string, string>);
  const fields: Record<string, string[]> = {
    person: ["label", "title", "department", "avatar"],
    agent: ["label", "role", "model", "avatar", "status"],
    department: ["label", "description"],
  };
  const nodeFields = fields[node.type as string] ?? ["label"];

  return (
    <div className="absolute right-4 top-4 w-64 bg-[#0f1013] border border-[#1e2130] rounded-xl shadow-2xl p-4 z-10">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-[#e2e5ed] capitalize">{node.type} Properties</div>
        <button onClick={onClose} className="text-[#5a5f6e] hover:text-[#e2e5ed]"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-2.5">
        {nodeFields.map((field) => (
          <div key={field}>
            <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-1 capitalize">{field}</label>
            <input
              value={form[field] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              className="w-full bg-[#161920] border border-[#1e2130] rounded-lg px-2.5 py-1.5 text-sm text-[#e2e5ed] focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => { onUpdate(node.id, form); onClose(); }}
          className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 rounded-lg py-1.5 text-xs font-medium transition-colors"
        >
          <Check className="w-3.5 h-3.5" /> Apply
        </button>
        <button
          onClick={() => { onDelete(node.id); onClose(); }}
          className="flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg px-3 py-1.5 text-xs transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Invite modal ────────────────────────────────────────────────────────────

const EMPTY_FORM: CreateInviteInput = {
  email: "",
  roleId: "member",
  departmentId: "",
  title: "",
  workspaceAccess: ["dashboard", "chat"],
  defaultAgentTeamId: "",
};

function InviteModal({ onClose, onSent }: { onClose: () => void; onSent: (inv: OrgInvite) => void }) {
  const [form, setForm] = useState<CreateInviteInput>(EMPTY_FORM);
  const [error, setError] = useState("");

  function toggle(wsId: string) {
    setForm((f) => ({
      ...f,
      workspaceAccess: f.workspaceAccess.includes(wsId)
        ? f.workspaceAccess.filter((w) => w !== wsId)
        : [...f.workspaceAccess, wsId],
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.includes("@")) { setError("Enter a valid email address."); return; }
    const inv = createInvite(ORG_ID, form, SELF_MEMBER_ID);
    onSent(inv);
  }

  const selectedRole = SYSTEM_ROLES.find((r) => r.id === form.roleId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0c0e12] border border-[#1e2130] rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2130]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#e2e5ed]">Invite team member</div>
              <div className="text-[10px] text-[#5a5f6e]">They&apos;ll receive an email with a secure link</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#5a5f6e] hover:text-[#e2e5ed] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-1.5">Email address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5a5f6e]" />
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => { setError(""); setForm((f) => ({ ...f, email: e.target.value })); }}
                placeholder="teammate@company.com"
                className="w-full bg-[#0f1117] border border-[#1e2130] rounded-lg pl-9 pr-3 py-2 text-sm text-[#e2e5ed] placeholder:text-[#3a3f50] focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
          </div>

          {/* Role + Title row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-1.5">Role</label>
              <div className="relative">
                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5a5f6e] pointer-events-none" />
                <select
                  value={form.roleId}
                  onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                  className="w-full appearance-none bg-[#0f1117] border border-[#1e2130] rounded-lg pl-9 pr-8 py-2 text-sm text-[#e2e5ed] focus:outline-none focus:border-indigo-500/60 transition-colors"
                >
                  {SYSTEM_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#5a5f6e] pointer-events-none" />
              </div>
              {selectedRole && (
                <div className="mt-1 text-[9px] text-[#5a5f6e]">
                  {selectedRole.permissions.length} permissions
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-1.5">Job title</label>
              <input
                value={form.title ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Sr. Engineer"
                className="w-full bg-[#0f1117] border border-[#1e2130] rounded-lg px-3 py-2 text-sm text-[#e2e5ed] placeholder:text-[#3a3f50] focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
          </div>

          {/* Department + AI Team row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-1.5">Department</label>
              <div className="relative">
                <select
                  value={form.departmentId ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                  className="w-full appearance-none bg-[#0f1117] border border-[#1e2130] rounded-lg px-3 pr-8 py-2 text-sm text-[#e2e5ed] focus:outline-none focus:border-indigo-500/60 transition-colors"
                >
                  <option value="">No department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#5a5f6e] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-1.5">Default AI team</label>
              <div className="relative">
                <select
                  value={form.defaultAgentTeamId ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, defaultAgentTeamId: e.target.value }))}
                  className="w-full appearance-none bg-[#0f1117] border border-[#1e2130] rounded-lg px-3 pr-8 py-2 text-sm text-[#e2e5ed] focus:outline-none focus:border-indigo-500/60 transition-colors"
                >
                  <option value="">Auto-assign</option>
                  {AGENT_TEAMS.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#5a5f6e] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Workspace access */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#5a5f6e] block mb-2">Workspace access</label>
            <div className="grid grid-cols-3 gap-1.5">
              {WORKSPACES.map((ws) => {
                const active = form.workspaceAccess.includes(ws.id);
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => toggle(ws.id)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                      active
                        ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                        : "bg-[#0f1117] border-[#1e2130] text-[#5a5f6e] hover:border-[#2a2f40] hover:text-[#7a8099]"
                    )}
                  >
                    {ws.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-[#1e2130] text-sm text-[#7a8099] hover:text-[#e2e5ed] hover:border-[#2a2f40] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white font-medium transition-colors flex items-center justify-center gap-2"
            >
              <UserPlus className="w-3.5 h-3.5" /> Send invite
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pending invites panel ────────────────────────────────────────────────────

const _PANEL_NOW = Date.now();

function daysLeft(exp: Date) {
  const d = Math.ceil((exp.getTime() - _PANEL_NOW) / (1000 * 60 * 60 * 24));
  return d > 0 ? `${d}d` : "expired";
}

function InviteRow({ inv, onRevoke }: { inv: OrgInvite; onRevoke: (id: string) => void }) {
  const role = SYSTEM_ROLES.find((r) => r.id === inv.roleId);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-[#1e2130] flex items-center justify-center shrink-0">
        <Mail className="w-3.5 h-3.5 text-[#5a5f6e]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[#c8cdd8] truncate">{inv.email}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {role && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ color: role.color, background: role.color + "22" }}>
              {role.name}
            </span>
          )}
          <span className="text-[9px] text-[#5a5f6e]">expires {daysLeft(inv.expiresAt)}</span>
        </div>
      </div>
      <button onClick={() => onRevoke(inv.id)} title="Revoke invite" className="text-[#3a3f50] hover:text-red-400 transition-colors shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function PendingInvitesPanel({ invites, onRevoke, onClose }: {
  invites: OrgInvite[];
  onRevoke: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 bottom-4 w-80 bg-[#0c0e12] border border-[#1e2130] rounded-xl shadow-2xl z-10">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2130]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-sm font-semibold text-[#e2e5ed]">Pending invites</span>
          <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5">
            {invites.length}
          </span>
        </div>
        <button onClick={onClose} className="text-[#5a5f6e] hover:text-[#e2e5ed]"><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-[#1e2130]">
        {invites.length === 0 ? (
          <div className="px-4 py-6 text-xs text-[#5a5f6e] text-center">No pending invites</div>
        ) : (
          invites.map((inv) => <InviteRow key={inv.id} inv={inv} onRevoke={onRevoke} />)
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OrgPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(DEFAULT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<OrgInvite[]>(() => listInvites(ORG_ID));
  const idRef = useRef(0);

  useEffect(() => {
    fetch("/api/org")
      .then((r) => r.json())
      .then((data) => {
        if (data.nodes && Array.isArray(data.nodes) && data.nodes.length > 0) {
          setNodes(data.nodes as Node[]);
          setEdges(data.edges as Edge[]);
        }
      })
      .catch(() => {});
  }, [setNodes, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "#3a3f50" } }, eds));
  }, [setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  function addNode(type: "person" | "agent" | "department") {
    const defaults: Record<string, Record<string, string>> = {
      person: { label: "New Person", title: "Role", avatar: "👤", department: "" },
      agent: { label: "New Agent", role: "Assistant", avatar: "🤖", model: "claude-sonnet-4-6", status: "online" },
      department: { label: "New Department", description: "" },
    };
    const offset = (++idRef.current % 6) * 60;
    const newNode: Node = {
      id: `${type}-${idRef.current}`,
      type,
      position: { x: 200 + offset, y: 200 + offset },
      data: defaults[type],
    };
    setNodes((nds) => [...nds, newNode]);
  }

  function updateNode(id: string, data: Record<string, string>) {
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data } : n));
  }

  function deleteNode(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }

  async function saveChart() {
    setSaving(true);
    try {
      await fetch("/api/org", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleInviteSent(inv: OrgInvite) {
    setPendingInvites(listInvites(ORG_ID));
    setShowInviteModal(false);
    setShowPending(true);
    void inv;
  }

  function handleRevoke(inviteId: string) {
    revokeInvite(inviteId);
    setPendingInvites(listInvites(ORG_ID));
  }

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        defaultEdgeOptions={{ style: { stroke: "#3a3f50", strokeWidth: 1.5 } }}
        style={{ background: "#ECEEF2" }}
      >
        <Background color="#d0d3db" gap={20} size={1} />
        <Controls className="!bg-[#0f1013] !border-[#1e2130] !rounded-xl [&>button]:!bg-[#0f1013] [&>button]:!border-[#1e2130] [&>button]:!text-[#7a8099] [&>button:hover]:!bg-[#161920]" />
        <MiniMap
          nodeColor={(n) => n.type === "agent" ? "#7c3aed" : n.type === "department" ? "#06b6d4" : "#6366f1"}
          className="!bg-[#0f1013] !border-[#1e2130] !rounded-xl"
        />

        <Panel position="top-left">
          <div className="flex items-center gap-2 bg-[#0f1013] border border-[#1e2130] rounded-xl p-2 shadow-xl">
            <span className="text-xs text-[#5a5f6e] px-1">Add:</span>
            <button onClick={() => addNode("person")} className="flex items-center gap-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors">
              <Users className="w-3.5 h-3.5" /> Person
            </button>
            <button onClick={() => addNode("agent")} className="flex items-center gap-1.5 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors">
              <Bot className="w-3.5 h-3.5" /> Agent
            </button>
            <button onClick={() => addNode("department")} className="flex items-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors">
              <Building2 className="w-3.5 h-3.5" /> Dept
            </button>
            <div className="w-px h-5 bg-[#1e2130] mx-0.5" />
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" /> Invite
            </button>
            <button
              onClick={() => setShowPending((p) => !p)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                showPending
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-[#161920] hover:bg-[#1e2130] text-[#7a8099]"
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              Pending
              {pendingInvites.length > 0 && (
                <span className="text-[9px] bg-amber-500/20 text-amber-400 rounded-full px-1.5">{pendingInvites.length}</span>
              )}
            </button>
            <div className="w-px h-5 bg-[#1e2130] mx-0.5" />
            <button
              onClick={saveChart}
              disabled={saving}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                saved ? "bg-emerald-500/20 text-emerald-400" : "bg-[#161920] hover:bg-[#1e2130] text-[#7a8099] hover:text-[#e2e5ed]"
              )}
            >
              {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {selectedNode && (
        <EditPanel node={selectedNode} onUpdate={updateNode} onDelete={deleteNode} onClose={() => setSelectedNode(null)} />
      )}

      {showPending && (
        <PendingInvitesPanel
          invites={pendingInvites}
          onRevoke={handleRevoke}
          onClose={() => setShowPending(false)}
        />
      )}

      {showInviteModal && (
        <InviteModal onClose={() => setShowInviteModal(false)} onSent={handleInviteSent} />
      )}
    </div>
  );
}
