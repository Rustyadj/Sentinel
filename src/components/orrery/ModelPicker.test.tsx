import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelPicker } from "./ModelPicker";

const agents = [{ id: "codex", name: "Codex", color: "#7dd3fc", model: "gpt-5.6-sol" }];
const settings = (model: string, effort: string | null = "medium") => ({
  runtime: "codex", provider: "openai", effect: "new_sessions", efforts: ["low", "medium", "high"],
  config: { runtimeModelId: model, effort, source: "agent" },
  options: [{ id: "gpt-5.6-sol", state: "AVAILABLE" }, { id: "gpt-6-astra", state: "unverified" }],
});

afterEach(() => vi.unstubAllGlobals());

describe("ModelPicker", () => {
  it("loads real settings for the active agent and saves a different model", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "PUT" ? settings("gpt-6-astra") : settings("gpt-5.6-sol")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ModelPicker agents={agents} activeAgentId="codex" />);

    await userEvent.click(screen.getByRole("button", { name: /gpt-5.6-sol/ }));
    expect(await screen.findByRole("radio", { name: /gpt-6-astra/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/codex/model", expect.anything());

    await userEvent.click(screen.getByRole("radio", { name: /gpt-6-astra/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agents/codex/model", expect.objectContaining({ method: "PUT", body: JSON.stringify({ model: "gpt-6-astra" }) })));
    expect(screen.getByText("Applies to new sessions.")).toBeInTheDocument();
  });

  it("explains a refusal instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })));
    render(<ModelPicker agents={agents} activeAgentId="codex" />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/admins/i);
  });

  it("shows the model of the agent the conversation is with, and follows it when that changes", async () => {
    const two = [
      { id: "codex", name: "Codex", color: "#7dd3fc", model: "gpt-6-astra" },
      { id: "hermes-lisa", name: "Hermes Lisa", color: "#a78bfa", model: "deepseek/deepseek-v4.1-flash" },
    ];
    // The chip used to keep showing whichever agent was active when the page mounted.
    const { rerender } = render(<ModelPicker agents={two} activeAgentId="codex" />);
    expect(screen.getByRole("button", { name: /gpt-6-astra/ })).toBeInTheDocument();
    rerender(<ModelPicker agents={two} activeAgentId="hermes-lisa" />);
    expect(screen.getByRole("button", { name: /deepseek\/deepseek-v4.1-flash/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gpt-6-astra/ })).not.toBeInTheDocument();
  });

  it("does not show one agent's saved model as another's after switching agents", async () => {
    const two = [
      { id: "codex", name: "Codex", color: "#7dd3fc", model: "gpt-6-astra" },
      { id: "hermes-lisa", name: "Hermes Lisa", color: "#a78bfa", model: "deepseek/deepseek-v4.1-flash" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(settings("gpt-5.6-sol")), { status: 200 })));
    const { rerender } = render(<ModelPicker agents={two} activeAgentId="codex" />);
    await userEvent.click(screen.getByRole("button", { name: /gpt-6-astra/ }));      // loads Codex's real setting
    await screen.findByRole("radio", { name: /gpt-5.6-sol/ });
    await userEvent.keyboard("{Escape}");
    rerender(<ModelPicker agents={two} activeAgentId="hermes-lisa" />);
    expect(screen.getByRole("button", { name: /deepseek/ })).toBeInTheDocument();     // not Codex's loaded gpt-5.6-sol
  });
});
