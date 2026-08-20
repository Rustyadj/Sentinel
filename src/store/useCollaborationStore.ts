import { create } from "zustand";
import type {
  AgentDisagreement,
  AgentMessage,
  AgentMessageType,
  CollaborationArtifact,
  CollaborationDecision,
  CollaborationEvent,
  CollaborationMode,
  CollaborationParticipant,
  CollaborationTask,
  TaskStatus,
} from "@/types/collaboration";

export interface CollaborationApproval {
  id: string;
  title: string;
  command: string;
  environment: string;
  risk: "low" | "medium" | "high";
  requestedByAgentId: string;
  status: "pending" | "approved" | "denied";
}

export interface AgentActivityEntry {
  id: string;
  agentId: string;
  taskId?: string;
  at: string;
  action: string;
  detail?: string;
  kind: "read" | "write" | "test" | "command" | "status";
}

export interface StructuredCommandResult {
  id: string;
  command: string;
  title: string;
  detail: string;
  createdAt: string;
}

interface CollaborationState {
  roomId: string;
  roomName: string;
  workspace: string;
  participants: CollaborationParticipant[];
  tasks: CollaborationTask[];
  messages: AgentMessage[];
  artifacts: CollaborationArtifact[];
  decisions: CollaborationDecision[];
  disagreements: AgentDisagreement[];
  events: CollaborationEvent[];
  approvals: CollaborationApproval[];
  activity: AgentActivityEntry[];
  commandResults: StructuredCommandResult[];
  mode: CollaborationMode;
  soloAgentId: string;
  paused: boolean;
  selectedTaskId: string | null;
  selectedParticipantId: string | null;
  selectedArtifactId: string | null;
  laneOpen: boolean;
  graphOpen: boolean;
  commandPaletteOpen: boolean;
}

interface CollaborationActions {
  sendMessage: (content: string, recipientAgentIds: string[], type?: AgentMessageType) => void;
  assignTask: (title: string, ownerAgentId?: string) => void;
  setMode: (mode: CollaborationMode) => void;
  setSoloAgentId: (agentId: string) => void;
  setPaused: (paused: boolean) => void;
  cancelTask: (taskId: string) => void;
  reassignTask: (taskId: string, ownerAgentId: string) => void;
  stopAgent: (agentId: string) => void;
  approve: (approvalId: string) => void;
  deny: (approvalId: string) => void;
  resolveDisagreement: (disagreementId: string, agentId: string) => void;
  addCommandResult: (result: Omit<StructuredCommandResult, "id" | "createdAt">) => void;
  setSelectedTaskId: (taskId: string | null) => void;
  setSelectedParticipantId: (agentId: string | null) => void;
  setSelectedArtifactId: (artifactId: string | null) => void;
  setLaneOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  reset: () => void;
}

export type CollaborationStore = CollaborationState & CollaborationActions;

const AT = {
  start: "2026-08-19T15:40:00.000Z",
  delegated: "2026-08-19T15:42:00.000Z",
  claimed: "2026-08-19T15:43:00.000Z",
  review: "2026-08-19T15:50:00.000Z",
  now: "2026-08-19T15:52:00.000Z",
};

export const collaborationFixtures: CollaborationState = {
  roomId: "room-collab-frontend",
  roomName: "Collaboration Room",
  workspace: "Sentinel OS / codex/collaboration-room-frontend",
  participants: [
    {
      agentId: "hermes",
      name: "Hermes",
      runtime: "persistent-agent-runtime",
      model: "claude-sonnet-4-6",
      role: "lead",
      status: "Coordinating",
      activeTaskId: "TASK-104",
      health: "CONNECTED",
      tokenUsage: { tokens: 18_420, costUsd: 0.19 },
      lastActivityAt: AT.now,
    },
    {
      agentId: "claude-code",
      name: "Claude Code",
      runtime: "claude-code",
      model: "claude-sonnet-4-6",
      role: "implementation",
      status: "Implementing",
      activeTaskId: "TASK-104",
      health: "BUSY",
      tokenUsage: { tokens: 42_115, costUsd: 0.41 },
      lastActivityAt: AT.now,
    },
    {
      agentId: "codex",
      name: "Codex",
      runtime: "codex",
      model: "gpt-5.6-sol",
      role: "review",
      status: "Reviewing",
      activeTaskId: "TASK-105",
      health: "CONNECTED",
      tokenUsage: { tokens: 27_806, costUsd: 0.31 },
      lastActivityAt: AT.review,
    },
  ],
  tasks: [
    {
      id: "TASK-104",
      title: "Build collaboration room shell",
      description: "Compose the persistent room, participant bar, message stream, composer, and control lane.",
      status: "RUNNING",
      ownerAgentId: "claude-code",
      reviewerAgentId: "codex",
      createdByAgentId: "hermes",
      dependsOnTaskIds: [],
      artifactIds: ["ART-12", "ART-14"],
    },
    {
      id: "TASK-105",
      title: "Review command and approval flows",
      description: "Check human control, routing, command parsing, and visible disagreement states.",
      status: "WAITING_REVIEW",
      ownerAgentId: "claude-code",
      reviewerAgentId: "codex",
      createdByAgentId: "hermes",
      dependsOnTaskIds: ["TASK-104"],
      artifactIds: ["ART-15"],
    },
    {
      id: "TASK-106",
      title: "Connect collaboration events to graph focus",
      description: "Brighten active agent, task, artifact, and file nodes without changing graph topology.",
      status: "PLANNED",
      ownerAgentId: "hermes",
      reviewerAgentId: "codex",
      createdByAgentId: "hermes",
      dependsOnTaskIds: ["TASK-104"],
      artifactIds: [],
    },
  ],
  messages: [
    {
      id: "MSG-1",
      roomId: "room-collab-frontend",
      senderAgentId: "hermes",
      recipientAgentIds: ["claude-code", "codex"],
      type: "DELEGATION",
      taskId: "TASK-104",
      content: "Claude Code, own the room shell and interaction states. Codex, review routing, approvals, and task transitions as each artifact lands.",
      createdAt: AT.delegated,
    },
    {
      id: "MSG-2",
      roomId: "room-collab-frontend",
      senderAgentId: "claude-code",
      recipientAgentIds: ["hermes", "codex"],
      type: "MESSAGE",
      taskId: "TASK-104",
      artifactIds: ["ART-12"],
      content: "The responsive three-pane shell is in place. I kept activity output separate from the conversation and exposed the task timeline through the lane.",
      createdAt: AT.claimed,
    },
    {
      id: "MSG-3",
      roomId: "room-collab-frontend",
      senderAgentId: "codex",
      recipientAgentIds: ["claude-code", "hermes"],
      type: "CHANGES_REQUESTED",
      taskId: "TASK-105",
      artifactIds: ["ART-14"],
      content: "Keep terminal output collapsed by default and make the approval risk and environment visible before the operator acts.",
      createdAt: AT.review,
    },
    {
      id: "MSG-4",
      roomId: "room-collab-frontend",
      senderAgentId: "hermes",
      recipientAgentIds: ["claude-code", "codex"],
      type: "DECISION",
      taskId: "TASK-105",
      content: "Decision: approvals stay inline in the room, while detailed execution history remains in the agent timeline.",
      createdAt: AT.now,
    },
  ],
  artifacts: [
    { id: "ART-12", type: "code_diff", title: "Collaboration shell diff", taskId: "TASK-104", createdByAgentId: "claude-code", createdAt: AT.claimed },
    { id: "ART-14", type: "test_report", title: "Composer interaction report", taskId: "TASK-104", createdByAgentId: "claude-code", createdAt: AT.review },
    { id: "ART-15", type: "review", title: "Human-control review", taskId: "TASK-105", createdByAgentId: "codex", createdAt: AT.now },
  ],
  decisions: [
    {
      id: "DEC-9",
      decision: "Keep execution logs out of the main conversation",
      reason: "The room should preserve intent and decisions while detailed runtime noise stays inspectable on demand.",
      proposedByAgentId: "codex",
      acceptedByAgentId: "hermes",
      relatedTaskIds: ["TASK-104", "TASK-105"],
      createdAt: AT.now,
    },
  ],
  disagreements: [
    {
      id: "DIS-3",
      taskId: "TASK-106",
      issue: "How aggressively should live collaboration events move the graph camera?",
      positions: [
        { agentId: "claude-code", position: "Follow each material event so the operator sees execution move through the graph.", evidence: "Strong spatial feedback during delegated work." },
        { agentId: "codex", position: "Brighten event nodes automatically, but move the camera only after explicit operator focus.", evidence: "Prevents involuntary camera motion while reading the room." },
      ],
      severity: "medium",
    },
  ],
  events: [
    { type: "room.created", roomId: "room-collab-frontend", payload: {}, occurredAt: AT.start },
    { type: "task.created", roomId: "room-collab-frontend", payload: { taskId: "TASK-104", title: "Build collaboration room shell" }, occurredAt: AT.delegated },
    { type: "task.claimed", roomId: "room-collab-frontend", payload: { taskId: "TASK-104", agentId: "claude-code" }, occurredAt: AT.claimed },
    { type: "task.started", roomId: "room-collab-frontend", payload: { taskId: "TASK-104", agentId: "claude-code" }, occurredAt: AT.claimed },
    { type: "artifact.created", roomId: "room-collab-frontend", payload: { taskId: "TASK-104", artifactId: "ART-12", title: "Collaboration shell diff" }, occurredAt: AT.review },
    { type: "task.review_requested", roomId: "room-collab-frontend", payload: { taskId: "TASK-105", agentId: "codex" }, occurredAt: AT.review },
    { type: "approval.requested", roomId: "room-collab-frontend", payload: { taskId: "TASK-105", approvalId: "APR-7" }, occurredAt: AT.now },
  ],
  approvals: [
    {
      id: "APR-7",
      title: "Run collaboration component test suite",
      command: "npm test -- tests/collaboration",
      environment: "isolated frontend worktree",
      risk: "low",
      requestedByAgentId: "claude-code",
      status: "pending",
    },
  ],
  activity: [
    { id: "ACT-1", agentId: "claude-code", taskId: "TASK-104", at: "2026-08-19T15:43:00.000Z", action: "Read ChatPanel.tsx", kind: "read" },
    { id: "ACT-2", agentId: "claude-code", taskId: "TASK-104", at: "2026-08-19T15:46:00.000Z", action: "Modified CollaborationRoom.tsx", detail: "Added responsive center and lane layout", kind: "write" },
    { id: "ACT-3", agentId: "claude-code", taskId: "TASK-104", at: "2026-08-19T15:50:00.000Z", action: "27 tests passed", kind: "test" },
    { id: "ACT-4", agentId: "codex", taskId: "TASK-105", at: "2026-08-19T15:50:00.000Z", action: "Reviewed approval flow", detail: "Requested explicit environment and risk", kind: "status" },
    { id: "ACT-5", agentId: "hermes", taskId: "TASK-106", at: "2026-08-19T15:52:00.000Z", action: "Queued graph integration", kind: "command" },
  ],
  commandResults: [],
  mode: "collaborative",
  soloAgentId: "hermes",
  paused: false,
  selectedTaskId: null,
  selectedParticipantId: null,
  selectedArtifactId: null,
  laneOpen: true,
  graphOpen: false,
  commandPaletteOpen: false,
};

function initialState(): CollaborationState {
  return structuredClone(collaborationFixtures);
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function eventFor(
  type: CollaborationEvent["type"],
  payload: Record<string, unknown>,
): CollaborationEvent {
  return { type, roomId: collaborationFixtures.roomId, payload, occurredAt: new Date().toISOString() };
}

function updateTaskStatus(tasks: CollaborationTask[], taskId: string, status: TaskStatus): CollaborationTask[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
}

export const useCollaborationStore = create<CollaborationStore>((set, get) => ({
  ...initialState(),
  sendMessage: (content, recipientAgentIds, type = "MESSAGE") => {
    const state = get();
    const createdAt = new Date().toISOString();
    const message: AgentMessage = {
      id: nextId("MSG"),
      roomId: state.roomId,
      senderAgentId: "user",
      recipientAgentIds,
      type,
      content,
      createdAt,
    };
    set({
      messages: [...state.messages, message],
      events: [...state.events, eventFor("execution.output", { recipientAgentIds, source: "user" })],
    });
  },
  assignTask: (title, ownerAgentId) => {
    const state = get();
    const id = `TASK-${104 + state.tasks.length}`;
    const task: CollaborationTask = {
      id,
      title,
      status: ownerAgentId ? "QUEUED" : "PLANNED",
      ownerAgentId,
      createdByAgentId: "user",
      dependsOnTaskIds: [],
      artifactIds: [],
    };
    set({
      tasks: [...state.tasks, task],
      selectedTaskId: id,
      events: [...state.events, eventFor("task.created", { taskId: id, title, ownerAgentId })],
    });
  },
  setMode: (mode) => set({ mode }),
  setSoloAgentId: (soloAgentId) => set({ soloAgentId }),
  setPaused: (paused) => set({ paused }),
  cancelTask: (taskId) => {
    const state = get();
    set({
      tasks: updateTaskStatus(state.tasks, taskId, "CANCELLED"),
      events: [...state.events, eventFor("execution.finished", { taskId, status: "cancelled" })],
    });
  },
  reassignTask: (taskId, ownerAgentId) => {
    const state = get();
    set({
      tasks: state.tasks.map((task) => task.id === taskId ? { ...task, ownerAgentId, status: "QUEUED" } : task),
      events: [...state.events, eventFor("task.claimed", { taskId, agentId: ownerAgentId, reassigned: true })],
    });
  },
  stopAgent: (agentId) => {
    const state = get();
    set({
      participants: state.participants.map((participant) => participant.agentId === agentId
        ? { ...participant, health: "DISCONNECTED", status: "Stopped", activeTaskId: undefined }
        : participant),
      events: [...state.events, eventFor("agent.finished", { agentId, stoppedBy: "user" })],
    });
  },
  approve: (approvalId) => {
    const state = get();
    set({
      approvals: state.approvals.map((approval) => approval.id === approvalId ? { ...approval, status: "approved" } : approval),
      events: [...state.events, eventFor("approval.granted", { approvalId })],
    });
  },
  deny: (approvalId) => {
    const state = get();
    set({
      approvals: state.approvals.map((approval) => approval.id === approvalId ? { ...approval, status: "denied" } : approval),
      events: [...state.events, eventFor("approval.denied", { approvalId })],
    });
  },
  resolveDisagreement: (disagreementId, agentId) => {
    const state = get();
    const disagreement = state.disagreements.find((item) => item.id === disagreementId);
    const position = disagreement?.positions.find((item) => item.agentId === agentId)?.position;
    set({
      disagreements: state.disagreements.map((item) => item.id === disagreementId
        ? { ...item, resolvedByAgentId: agentId, finalDecision: position }
        : item),
      decisions: position ? [...state.decisions, {
        id: nextId("DEC"),
        decision: position,
        reason: "Operator resolved the visible agent disagreement.",
        proposedByAgentId: agentId,
        acceptedByAgentId: "user",
        relatedTaskIds: disagreement?.taskId ? [disagreement.taskId] : [],
        createdAt: new Date().toISOString(),
      }] : state.decisions,
    });
  },
  addCommandResult: (result) => {
    const state = get();
    set({ commandResults: [...state.commandResults, { ...result, id: nextId("CMD"), createdAt: new Date().toISOString() }] });
  },
  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),
  setSelectedParticipantId: (selectedParticipantId) => set({ selectedParticipantId }),
  setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
  setLaneOpen: (laneOpen) => set({ laneOpen }),
  setGraphOpen: (graphOpen) => set({ graphOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  reset: () => set(initialState()),
}));
