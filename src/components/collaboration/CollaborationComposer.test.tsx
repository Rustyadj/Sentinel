import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCollaborationStore } from "@/store/useCollaborationStore";
import { CollaborationRoom } from "./CollaborationRoom";

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

beforeEach(() => {
  useCollaborationStore.getState().reset();
});

describe("CollaborationComposer — Lisa-first defaults", () => {
  it("defaults to a Lisa-addressed placeholder with no direct-worker indicator", () => {
    render(<CollaborationRoom />);
    expect(screen.getByRole("textbox", { name: "Collaboration message" })).toHaveAttribute("placeholder", "Message Hermes…");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a DIRECT WORKER MODE indicator and updates the placeholder once Solo mode is selected", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Collaboration mode" }), "solo");

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Direct worker mode");
    expect(banner).toHaveTextContent("Hermes");
    expect(screen.getByRole("textbox", { name: "Collaboration message" })).toHaveAttribute("placeholder", "Message Hermes directly…");
  });

  it("shows the same indicator for an explicit @mention override while staying in collaborative mode", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    const composer = screen.getByRole("textbox", { name: "Collaboration message" });
    await user.type(composer, "@Cod");
    const mentionList = screen.getByRole("listbox", { name: "Mention an agent" });
    await user.click(within(mentionList).getByRole("option", { name: /Codex/ }));

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Direct worker mode");
    expect(banner).toHaveTextContent("Codex");
    expect(useCollaborationStore.getState().mode).toBe("collaborative");
  });

  it("clears the direct-worker indicator after sending an @mention message and returning to a normal message", async () => {
    const user = userEvent.setup();
    render(<CollaborationRoom />);
    const composer = screen.getByRole("textbox", { name: "Collaboration message" });
    await user.type(composer, "@Cod");
    await user.click(within(screen.getByRole("listbox", { name: "Mention an agent" })).getByRole("option", { name: /Codex/ }));
    await user.type(composer, "please inspect the approval flow");
    await user.click(screen.getByRole("button", { name: "Send collaboration message" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Collaboration message" })).toHaveAttribute("placeholder", "Message Hermes…");
  });
});
