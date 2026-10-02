import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttentionCards } from "./AttentionCards";

const agents = [{ id: "codex", name: "Codex", color: "#7dd3fc" }];
const approval = { id: "a1", workspaceId: "ws", title: "Prod deploy", type: "deploy", risk: "high", requesterAgentId: "codex", description: null, createdAt: new Date().toISOString() };
const run = { id: "s1", kind: "session" as const, sessionId: "s1", agentId: "codex", status: "running", title: "Review PR21", startedAt: new Date().toISOString(), recent: [{ at: new Date().toISOString(), verb: "exec" as const, text: "vitest run" }] };

afterEach(() => vi.unstubAllGlobals());

describe("AttentionCards", () => {
  it("renders nothing when there is nothing to attend to", () => {
    const { container } = render(<AttentionCards runs={[]} approvals={[]} agents={agents} followId={null} onFollow={vi.fn()} onDecided={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("follows the run's agent from a run card", async () => {
    const onFollow = vi.fn();
    render(<AttentionCards runs={[run]} approvals={[]} agents={agents} followId={null} onFollow={onFollow} onDecided={vi.fn()} />);
    expect(screen.getByText("Review PR21")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /watch on graph/i }));
    expect(onFollow).toHaveBeenCalledWith("codex");
  });

  it("approves through the real approvals endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onDecided = vi.fn();
    render(<AttentionCards runs={[]} approvals={[approval]} agents={agents} followId={null} onFollow={vi.fn()} onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/approvals/a1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "approved" }) }));
  });

  it("shows the server's reason when a decision is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Missing permission: approval.review" }), { status: 403 })));
    const onDecided = vi.fn();
    render(<AttentionCards runs={[]} approvals={[approval]} agents={agents} followId={null} onFollow={vi.fn()} onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing permission: approval.review");
    expect(onDecided).not.toHaveBeenCalled();
  });
});
