import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MOCK_MISSION_CONTROL } from "@/lib/mission-control/mock";
import type { AttentionAction, MissionControlData, MissionControlService } from "@/lib/mission-control/types";
import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "@/lib/voice/types";
import { MissionControlPage } from "./MissionControlPage";
import { PersistentVoiceOrb } from "./PersistentVoiceOrb";

function cloneData(): MissionControlData {
  return structuredClone(MOCK_MISSION_CONTROL);
}

function createService(
  load: () => Promise<MissionControlData> = async () => cloneData()
): MissionControlService {
  return {
    load,
    resolveAttention: vi.fn(async (id: string, action: AttentionAction) => {
      void id;
      void action;
      return { ok: true };
    }),
  };
}

describe("MissionControlPage", () => {
  it("renders the operational Mission Brief summary", async () => {
    render(<MissionControlPage service={createService()} />);

    expect(await screen.findByRole("heading", { name: "Good morning, Rusty" })).toBeInTheDocument();
    expect(screen.getByText(/Eight items need your attention/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue Working" })).toBeInTheDocument();
    expect(screen.getByText("Urgent approvals")).toBeInTheDocument();
  });

  it("supports Attention Queue decisions", async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<MissionControlPage service={service} />);

    const titles = await screen.findAllByText("Approve production deployment");
    const row = titles.map((title) => title.closest("tr")).find(Boolean);
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLTableRowElement).getByRole("button", { name: /approve approve production deployment/i }));

    await waitFor(() => expect(screen.queryByText("Approve production deployment")).not.toBeInTheDocument());
    expect(service.resolveAttention).toHaveBeenCalledWith("attention-1", "approve");
  });

  it("switches Continue Working tabs", async () => {
    const user = userEvent.setup();
    render(<MissionControlPage service={createService()} />);
    const heading = await screen.findByRole("heading", { name: "Continue Where You Left Off" });
    const panel = within(heading.closest("section") as HTMLElement);
    expect(panel.getByText("Sentinel Mission Control")).toBeInTheDocument();
    await user.click(panel.getByRole("tab", { name: "Conversations" }));
    expect(panel.getByText("Neural graph direction")).toBeInTheDocument();
    expect(panel.queryByText("Sentinel Mission Control")).not.toBeInTheDocument();
  });

  it("shows the correct operational states for digital employees", async () => {
    render(<MissionControlPage service={createService()} />);
    const heading = await screen.findByRole("heading", { name: "AI Workforce" });
    const workforce = heading.closest("section");
    expect(workforce).not.toBeNull();
    const panel = within(workforce as HTMLElement);
    expect(panel.getByText("Hermes Lisa")).toBeInTheDocument();
    expect(panel.getByText("Claude Code")).toBeInTheDocument();
    expect(panel.getByText("Codex")).toBeInTheDocument();
    expect(panel.getByText("OpenClaw")).toBeInTheDocument();
    expect(panel.getByText(/^online ·/)).toBeInTheDocument();
    expect(panel.getByText(/^busy ·/)).toBeInTheDocument();
    expect(panel.getByText(/^error ·/)).toBeInTheDocument();
    expect(panel.getByText(/^offline ·/)).toBeInTheDocument();
  });

  it("keeps dense tables inside responsive overflow boundaries", async () => {
    const { container } = render(<MissionControlPage service={createService()} />);
    await screen.findByRole("heading", { name: "Attention Queue" });
    const tables = Array.from(container.querySelectorAll("table"));
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((table) => table.parentElement?.classList.contains("overflow-x-auto"))).toBe(true);
    const centeredContainer = Array.from(container.querySelectorAll("div")).find((element) =>
      element.classList.contains("w-full") && element.classList.contains("max-w-[1680px]")
    );
    expect(centeredContainer).toBeInTheDocument();
  });

  it("renders compact System Health statuses", async () => {
    render(<MissionControlPage service={createService()} />);
    const heading = await screen.findByRole("heading", { name: "System Health" });
    const panel = within(heading.closest("section") as HTMLElement);
    expect(panel.getByText("VPS CPU")).toBeInTheDocument();
    expect(panel.getByText("PostgreSQL")).toBeInTheDocument();
    expect(panel.getAllByText("healthy").length).toBeGreaterThan(0);
    expect(panel.getByText("degraded")).toBeInTheDocument();
  });

  it("renders loading, error, and empty states", async () => {
    const pendingService = createService(() => new Promise(() => {}));
    const loading = render(<MissionControlPage service={pendingService} />);
    expect(screen.getByTestId("mission-control-loading")).toBeInTheDocument();
    loading.unmount();

    const errorService = createService(async () => { throw new Error("Control plane unavailable"); });
    const errorView = render(<MissionControlPage service={errorService} />);
    expect(await screen.findByTestId("mission-control-error")).toHaveTextContent("Control plane unavailable");
    errorView.unmount();

    const emptyData = cloneData();
    emptyData.attention = [];
    emptyData.continueItems = [];
    emptyData.agents = [];
    emptyData.feed = [];
    render(<MissionControlPage service={createService(async () => emptyData)} />);
    expect(await screen.findByTestId("mission-control-empty")).toHaveTextContent("You are all caught up");
  });

  it("renders Voice Orb state changes through the provider abstraction", async () => {
    const user = userEvent.setup();
    let config: VoiceProviderConfig | null = null;
    let resolveSubmit: ((value: string) => void) | null = null;
    const submit = vi.fn(() => new Promise<string>((resolve) => { resolveSubmit = resolve; }));
    const provider: VoiceProvider = {
      name: "test",
      startSession: vi.fn(async (nextConfig) => {
        config = nextConfig;
        nextConfig.onStatusChange?.("listening");
      }),
      stopSession: vi.fn(async () => {}),
      sendAudio: vi.fn(async () => {}),
      sendText: vi.fn(async () => {}),
      getStatus: () => "idle" as VoiceStatus,
    };
    render(<PersistentVoiceOrb providerFactory={() => provider} submitTranscript={submit} />);
    await user.click(screen.getByRole("button", { name: "Start voice session" }));
    expect(await screen.findByText("Listening")).toBeInTheDocument();
    act(() => config?.onStatusChange?.("transcribing"));
    expect(screen.getByText("Transcribing")).toBeInTheDocument();
    act(() => config?.onTranscript?.({ text: "Show my approvals", isFinal: true }));
    expect(await screen.findByText("Sentinel is thinking")).toBeInTheDocument();
    await act(async () => resolveSubmit?.("You have three approvals."));
    expect(await screen.findByText("Sentinel is speaking")).toBeInTheDocument();
  });
});
