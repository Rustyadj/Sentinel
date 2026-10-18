import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import { TelegramPanel } from "@/modules/telegram/TelegramPanel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Telegram Mission Control", () => {
  it("shows both fixed agent bindings, webhook health and uncertain deliveries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, bots: [
      { id: "l", key: "lisa", agentId: "hermes-lisa", botId: "b1", enabled: true, lastWebhookAt: null, lastHealthAt: null, webhookHealth: {} },
      { id: "n", key: "nathan2", agentId: "hermes-nathan2", botId: "b2", enabled: false, lastWebhookAt: null, lastHealthAt: null, webhookHealth: {} },
    ], conversations: [], updates: [{ id: "u", telegramBotId: "l", messageId: "1", status: "succeeded", mediaPaths: [], receivedAt: new Date().toISOString(), deliveries: [{ id: "d", status: "uncertain", errorCode: "delivery_receipt_unknown" }] }] }) })));
    render(<TelegramPanel />);
    expect(await screen.findByText("Assigned agent: hermes-lisa")).toBeInTheDocument();
    expect(screen.getByText("Assigned agent: hermes-nathan2")).toBeInTheDocument();
    expect(screen.getByText(/uncertain \(delivery_receipt_unknown\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Check connection" })).toHaveLength(2);
  });
});
