import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCollaborationStore } from "@/store/useCollaborationStore";
import { CollaborationRoom } from "./CollaborationRoom";
import { parseSlashCommand } from "./CollaborationComposer";

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

beforeEach(() => {
  useCollaborationStore.getState().reset();
});

describe("CollaborationRoom", () => {
  it("renders participants and distinct collaboration message treatments", () => {
    render(<CollaborationRoom />);
    expect(screen.getByRole("main", { name: "Collaboration room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Hermes information" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Claude Code information" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Codex information" })).toBeInTheDocument();
    expect(screen.getByText("Delegation")).toBeInTheDocument();
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.getByText("Decision")).toBeInTheDocument();
  });

  it("routes @mentioned messages to the selected participant", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    const composer = screen.getByRole("textbox", { name: "Collaboration message" });
    await user.type(composer, "@Cod");
    const mentionList = screen.getByRole("listbox", { name: "Mention an agent" });
    await user.click(within(mentionList).getByRole("option", { name: /Codex/ }));
    expect(screen.getByText("Sent to:")).toBeInTheDocument();
    await user.type(composer, "please inspect the approval flow");
    await user.click(screen.getByRole("button", { name: "Send collaboration message" }));
    expect(useCollaborationStore.getState().messages.at(-1)?.recipientAgentIds).toEqual(["codex"]);
  });

  it("dispatches slash commands and renders a structured result", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    const composer = screen.getByRole("textbox", { name: "Collaboration message" });
    await user.type(composer, "/assign Verify responsive collaboration controls");
    await user.click(screen.getByRole("button", { name: "Send collaboration message" }));
    expect(await screen.findByText("Task assigned")).toBeInTheDocument();
    expect(useCollaborationStore.getState().tasks.at(-1)?.title).toBe("Verify responsive collaboration controls");
  });

  it("opens task detail from the command palette", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    await user.keyboard("{Control>}k{/Control}");
    const palette = screen.getByRole("dialog", { name: "Collaboration command palette" });
    await user.click(within(palette).getByText("Open task"));
    expect(await screen.findByRole("dialog", { name: "TASK-104" })).toBeInTheDocument();
    const taskDialog = await screen.findByRole("dialog", { name: "TASK-104" });
    expect(within(taskDialog).getByText("Build collaboration room shell")).toBeInTheDocument();
  });

  it("resolves approval and disagreement cards in place", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    const approval = screen.getByRole("region", { name: "Approval Run collaboration component test suite" });
    await user.click(within(approval).getByRole("button", { name: "Approve" }));
    expect(within(approval).getByText("approved")).toBeInTheDocument();

    const disagreement = screen.getByRole("region", { name: "Agent disagreement" });
    await user.click(within(disagreement).getByRole("button", { name: "Choose Codex" }));
    expect(await screen.findByText("Disagreement resolved")).toBeInTheDocument();
  });
});

describe("parseSlashCommand", () => {
  it("normalizes a command and preserves its arguments", () => {
    expect(parseSlashCommand(" /ASSIGN   Build the room ")).toEqual({ command: "/assign", args: "Build the room" });
    expect(parseSlashCommand("plain message")).toBeNull();
  });
});
