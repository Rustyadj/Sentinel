import { describe, expect, it } from "vitest";
import { agentCardUrl, readA2aResponse, readAgentCard, sendToAgent } from "./client";
import { OutsideAgentError, type OutsideRequest } from "./http";

const code = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof OutsideAgentError ? error.code : "other"; }
  return "none";
};

describe("agentCardUrl", () => {
  it("appends the well-known path to a base address and keeps a card address as it is", () => {
    expect(agentCardUrl("https://agent.example.com")).toBe("https://agent.example.com/.well-known/agent-card.json");
    expect(agentCardUrl("https://agent.example.com/team/")).toBe("https://agent.example.com/team/.well-known/agent-card.json");
    expect(agentCardUrl("https://agent.example.com/cards/a.json")).toBe("https://agent.example.com/cards/a.json");
  });

  it.each([
    ["http://agent.example.com", "url_invalid"], ["ftp://agent.example.com", "url_invalid"], ["https://user:pw@agent.example.com", "url_invalid"],
    ["not a url", "url_invalid"], ["https://localhost:8443", "url_not_public"], ["https://127.0.0.1", "url_not_public"],
    ["https://169.254.169.254/latest", "url_not_public"], ["https://[::1]/", "url_not_public"], ["https://10.0.0.5", "url_not_public"],
  ])("refuses %s", (url, expected) => expect(code(() => agentCardUrl(url))).toBe(expected));
});

describe("readAgentCard", () => {
  it("reads a 1.0 card by its JSON-RPC interface", () => {
    const card = readAgentCard({
      name: "  Ledger   Bot ", description: "Reconciles invoices.",
      supportedInterfaces: [
        { url: "https://agent.example.com/grpc", protocolBinding: "GRPC", protocolVersion: "1.0" },
        { url: "https://agent.example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      ],
    });
    expect(card).toEqual({ name: "Ledger Bot", description: "Reconciles invoices.", endpointUrl: "https://agent.example.com/a2a", dialect: "1.0" });
  });

  it("reads a 0.3 card by its top-level url", () => {
    expect(readAgentCard({ name: "Old", url: "https://old.example.com/rpc", protocolVersion: "0.3.0" })).toMatchObject({ endpointUrl: "https://old.example.com/rpc", dialect: "0.3" });
  });

  it("refuses a card that offers no JSON-RPC interface, has no name, or names a private endpoint", () => {
    expect(code(() => readAgentCard({ name: "G", supportedInterfaces: [{ url: "https://a.example.com", protocolBinding: "GRPC" }] }))).toBe("protocol_unsupported");
    expect(code(() => readAgentCard({ name: "G", url: "https://a.example.com", preferredTransport: "GRPC" }))).toBe("protocol_unsupported");
    expect(code(() => readAgentCard({ url: "https://a.example.com" }))).toBe("bad_response");
    expect(code(() => readAgentCard("<html>"))).toBe("bad_response");
    // A public card must not be able to point Sentinel at an internal address.
    expect(code(() => readAgentCard({ name: "Evil", url: "https://192.168.0.10/rpc" }))).toBe("url_not_public");
    expect(code(() => readAgentCard({ name: "Evil", supportedInterfaces: [{ url: "http://agent.example.com", protocolBinding: "JSONRPC" }] }))).toBe("url_invalid");
  });
});

describe("readA2aResponse", () => {
  it("reads a direct message in both dialects", () => {
    expect(readA2aResponse({ result: { message: { role: "ROLE_AGENT", parts: [{ text: "Hello" }, { data: {} }, { text: "there" }] } } })).toEqual({ kind: "reply", text: "Hello\nthere" });
    expect(readA2aResponse({ result: { kind: "message", role: "agent", parts: [{ kind: "text", text: "Hi" }] } })).toEqual({ kind: "reply", text: "Hi" });
  });

  it("reads a completed task from its artifacts, falling back to its status message", () => {
    expect(readA2aResponse({ result: { task: { id: "t", status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ parts: [{ text: "A" }] }, { parts: [{ text: "B" }] }] } } })).toEqual({ kind: "reply", text: "A\n\nB" });
    expect(readA2aResponse({ result: { kind: "task", id: "t", status: { state: "completed", message: { parts: [{ kind: "text", text: "Done" }] } } } })).toEqual({ kind: "reply", text: "Done" });
  });

  it("treats a question from the agent as its reply", () => {
    expect(readA2aResponse({ result: { task: { id: "t", status: { state: "TASK_STATE_INPUT_REQUIRED", message: { parts: [{ text: "Which month?" }] } } } } })).toEqual({ kind: "reply", text: "Which month?" });
  });

  it("reports a task still running as pending", () => {
    expect(readA2aResponse({ result: { task: { id: "t9", status: { state: "TASK_STATE_WORKING" } } } })).toEqual({ kind: "pending", taskId: "t9" });
    expect(readA2aResponse({ result: { kind: "task", id: "t9", status: { state: "submitted" } } })).toEqual({ kind: "pending", taskId: "t9" });
  });

  it("reports failures, and never invents text for an empty answer", () => {
    expect(readA2aResponse({ error: { code: -32000, message: "quota exceeded" } })).toEqual({ kind: "failed", reason: "quota exceeded" });
    expect(readA2aResponse({ result: { task: { id: "t", status: { state: "TASK_STATE_FAILED" } } } })).toEqual({ kind: "failed", reason: "The agent's task ended as failed." });
    expect(readA2aResponse({ result: { task: { id: "t", status: { state: "TASK_STATE_AUTH_REQUIRED" } } } }).kind).toBe("failed");
    expect(code(() => readA2aResponse({ result: { task: { id: "t", status: { state: "TASK_STATE_COMPLETED" } } } }))).toBe("bad_response");
    expect(code(() => readA2aResponse({ result: { message: { parts: [] } } }))).toBe("bad_response");
    expect(code(() => readA2aResponse({}))).toBe("bad_response");
  });
});

describe("sendToAgent", () => {
  const input = { endpointUrl: "https://agent.example.com/a2a", token: "tok", prompt: "What is due?" };

  it("speaks 1.0: SendMessage, plain parts, ROLE_USER, the version header and the bearer token", async () => {
    const seen: OutsideRequest[] = [];
    const reply = await sendToAgent({ ...input, dialect: "1.0" }, { transport: async (request) => { seen.push(request); return { result: { message: { parts: [{ text: "Three invoices." }] } } }; } });
    expect(reply).toBe("Three invoices.");
    expect(seen).toHaveLength(1);
    expect(seen[0].headers).toMatchObject({ authorization: "Bearer tok", "a2a-version": "1.0" });
    expect(seen[0].body).toMatchObject({ jsonrpc: "2.0", method: "SendMessage", params: { message: { role: "ROLE_USER", parts: [{ text: "What is due?" }] } } });
  });

  it("speaks 0.3: message/send, kinded parts, role user, no version header", async () => {
    const seen: OutsideRequest[] = [];
    await sendToAgent({ ...input, dialect: "0.3" }, { transport: async (request) => { seen.push(request); return { result: { kind: "message", parts: [{ kind: "text", text: "ok" }] } }; } });
    expect(seen[0].headers).not.toHaveProperty("a2a-version");
    expect(seen[0].body).toMatchObject({ method: "message/send", params: { message: { kind: "message", role: "user", parts: [{ kind: "text", text: "What is due?" }] }, configuration: { blocking: true } } });
  });

  it("polls a task that is still running until it completes", async () => {
    const methods: string[] = [];
    const answers = [
      { result: { task: { id: "t1", status: { state: "TASK_STATE_WORKING" } } } },
      { result: { id: "t1", status: { state: "TASK_STATE_WORKING" } } },
      { result: { id: "t1", status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ parts: [{ text: "Finished." }] }] } },
    ];
    const reply = await sendToAgent({ ...input, dialect: "1.0" }, {
      pollIntervalMs: 1,
      transport: async (request) => { methods.push((request.body as { method: string }).method); return answers.shift(); },
    });
    expect(reply).toBe("Finished.");
    expect(methods).toEqual(["SendMessage", "GetTask", "GetTask"]);
  });

  it("gives up at the deadline instead of polling forever", async () => {
    const error = await sendToAgent({ ...input, dialect: "1.0" }, {
      deadlineMs: 30, pollIntervalMs: 20,
      transport: async () => ({ result: { task: { id: "t1", status: { state: "TASK_STATE_WORKING" } } } }),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OutsideAgentError);
    expect((error as OutsideAgentError).code).toBe("timed_out");
  });

  it("throws what the agent said when it fails", async () => {
    await expect(sendToAgent({ ...input, dialect: "1.0" }, { transport: async () => ({ error: { message: "model overloaded" } }) })).rejects.toThrow("model overloaded");
  });
});
