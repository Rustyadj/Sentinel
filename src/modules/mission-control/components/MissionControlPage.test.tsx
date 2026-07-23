import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MissionControlData, MissionControlService } from "@/lib/mission-control/types";
import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "@/lib/voice/types";
import { MissionControlPage } from "./MissionControlPage";
import { PersistentVoiceOrb } from "./PersistentVoiceOrb";

const live = { state: "live" as const, source: "PostgreSQL", observedAt: "2026-07-22T12:00:00.000Z" };

function cloneData(): MissionControlData {
  return structuredClone({
    greetingName: "Rusty",
    operationalSummary: "1 decision pending and 0 blocked or failed tasks.",
    generatedAt: "2026-07-22T12:00:00.000Z",
    sources: {
      summary: live, continue: live, attention: live, feed: live, neural: live, context: live,
      agents: { state: "unavailable", source: "PostgreSQL agent registry", observedAt: "2026-07-22T12:00:00.000Z", reason: "Runtime telemetry is unavailable; registry fields only" },
      health: { state: "unavailable", source: "VPS telemetry", observedAt: null, reason: "Telemetry is not configured" },
    },
    context: [{ id: "workspace", label: "Workspace", value: "Sentinel", options: ["Sentinel"] }],
    summaryMetrics: [{ id: "pending", label: "Pending decisions", value: 1, detail: "Approvals and learning candidates", tone: "warning", actionLabel: "Review", href: "/workflows?tab=approvals" }],
    continueItems: [
      { id: "project:1", type: "project", title: "Sentinel Control Plane", context: "Project", lastActivity: "2 min ago", status: "active", href: "/projects/1" },
      { id: "room:1", type: "conversation", title: "Deployment review", context: "2 agents", lastActivity: "5 min ago", status: "Available", href: "/chat" },
    ],
    attention: [{ id: "approval:1", targetId: "1", targetType: "approval", href: "/workflows?tab=approvals", title: "Approve production deployment", detail: "Exact SHA release", category: "approval", severity: "high", owner: "Release manager", source: "Sentinel", timestamp: "1 min ago", actions: ["approve", "reject", "review"] }],
    agents: [{ id: "agent-1", name: "Hermes Lisa", role: "Orchestrator", status: "online", model: "claude", currentTask: null, context: "Sentinel", progress: null, voiceState: "unavailable", health: { cpu: null, memory: null, runtime: null }, costToday: null, href: "/agents/agent-1" }],
    feed: [{ id: "audit:1", scope: "system", event: "deployment approved", actor: "user", source: "Audit log", timestamp: "1 min ago", tone: "positive", href: "/settings" }],
    health: [
      { id: "cpu", label: "VPS CPU", status: "unavailable", value: "Unavailable", detail: "Telemetry is not configured" },
      { id: "postgres", label: "PostgreSQL", status: "healthy", value: "Connected", detail: "Mission Control query succeeded" },
    ],
    neural: { workspace: "Sentinel", project: "Sentinel Control Plane", repository: null, branch: null, activeAgentIds: ["agent-1"], nodes: [{ id: "node-1", label: "Release policy", kind: "decision" }], edges: [], counts: { decisions: 1, memories: 0, tasks: 0, blocked: 0 } },
    quickActions: [{ id: "project", label: "New project", href: "/projects", icon: "project" }],
  } satisfies MissionControlData);
}

function createService(load: () => Promise<MissionControlData> = async () => cloneData()): MissionControlService {
  return {
    load,
    resolveAttention: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("MissionControlPage", () => {
  it("renders real source labels with the mission summary", async () => {
    render(<MissionControlPage service={createService()} />);
    expect(await screen.findByRole("heading", { name: "Good morning, Rusty" })).toBeInTheDocument();
    expect(screen.getByText(/1 decision pending/)).toBeInTheDocument();
    expect(screen.getByText("Pending decisions")).toBeInTheDocument();
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
  });

  it("only removes an approval after the real service succeeds", async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<MissionControlPage service={service} />);
    const titles = await screen.findAllByText("Approve production deployment");
    const row = titles.map((title) => title.closest("tr")).find(Boolean);
    await user.click(within(row as HTMLTableRowElement).getByRole("button", { name: /approve approve production deployment/i }));
    await waitFor(() => expect(screen.queryByText("Approve production deployment")).not.toBeInTheDocument());
    expect(service.resolveAttention).toHaveBeenCalledWith(expect.objectContaining({ targetId: "1", targetType: "approval" }), "approve");
  });

  it("keeps a failed approval visible and reports the error", async () => {
    const user = userEvent.setup();
    const service = createService();
    service.resolveAttention = vi.fn(async () => { throw new Error("Approval was rejected by the API"); });
    render(<MissionControlPage service={service} />);
    const titles = await screen.findAllByText("Approve production deployment");
    const row = titles.map((title) => title.closest("tr")).find(Boolean);
    await user.click(within(row as HTMLTableRowElement).getByRole("button", { name: /approve approve production deployment/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Approval was rejected by the API");
    expect(screen.getAllByText("Approve production deployment").length).toBeGreaterThan(0);
  });

  it("switches recent-work tabs", async () => {
    const user = userEvent.setup();
    render(<MissionControlPage service={createService()} />);
    const panel = within((await screen.findByRole("heading", { name: "Continue Where You Left Off" })).closest("section") as HTMLElement);
    expect(panel.getByText("Sentinel Control Plane")).toBeInTheDocument();
    await user.click(panel.getByRole("tab", { name: "Conversations" }));
    expect(panel.getByText("Deployment review")).toBeInTheDocument();
  });

  it("does not invent missing agent runtime and cost metrics", async () => {
    render(<MissionControlPage service={createService()} />);
    const panel = within((await screen.findByRole("heading", { name: "AI Workforce" })).closest("section") as HTMLElement);
    expect(panel.getByText("Runtime task unavailable")).toBeInTheDocument();
    expect(panel.getByText("Cost unavailable")).toBeInTheDocument();
    expect(panel.getByText(/Runtime unavailable/)).toBeInTheDocument();
  });

  it("renders explicit health unavailability alongside live database health", async () => {
    render(<MissionControlPage service={createService()} />);
    const panel = within((await screen.findByRole("heading", { name: "System Health" })).closest("section") as HTMLElement);
    expect(panel.getByText("VPS CPU")).toBeInTheDocument();
    expect(panel.getByText("PostgreSQL")).toBeInTheDocument();
    expect(panel.getByText("healthy")).toBeInTheDocument();
    expect(panel.getByText("Unavailable")).toBeInTheDocument();
  });

  it("renders loading and error states", async () => {
    const loading = render(<MissionControlPage service={createService(() => new Promise(() => {}))} />);
    expect(screen.getByTestId("mission-control-loading")).toBeInTheDocument();
    loading.unmount();
    render(<MissionControlPage service={createService(async () => { throw new Error("Control plane unavailable"); })} />);
    expect(await screen.findByTestId("mission-control-error")).toHaveTextContent("Control plane unavailable");
  });

  it("renders Voice Orb state changes through the provider abstraction", async () => {
    const user = userEvent.setup();
    let config: VoiceProviderConfig | null = null;
    let resolveSubmit: ((value: string) => void) | null = null;
    const submit = vi.fn(() => new Promise<string>((resolve) => { resolveSubmit = resolve; }));
    const provider: VoiceProvider = {
      name: "test",
      startSession: vi.fn(async (nextConfig) => { config = nextConfig; nextConfig.onStatusChange?.("listening"); }),
      stopSession: vi.fn(async () => {}), sendAudio: vi.fn(async () => {}), sendText: vi.fn(async () => {}), getStatus: () => "idle" as VoiceStatus,
    };
    render(<PersistentVoiceOrb providerFactory={() => provider} submitTranscript={submit} />);
    await user.click(screen.getByRole("button", { name: "Start voice session" }));
    expect(await screen.findByText("Listening")).toBeInTheDocument();
    act(() => config?.onStatusChange?.("transcribing"));
    act(() => config?.onTranscript?.({ text: "Show my approvals", isFinal: true }));
    expect(await screen.findByText("Sentinel is thinking")).toBeInTheDocument();
    await act(async () => resolveSubmit?.("You have one approval."));
    expect(await screen.findByText("Sentinel is speaking")).toBeInTheDocument();
  });
});
