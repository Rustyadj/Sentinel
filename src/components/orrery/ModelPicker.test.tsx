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
});
