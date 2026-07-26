import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
import { db } from "@/lib/db";
import { proposeMemoryCandidate } from "@/lib/adaptive-memory/memory-candidate-service";
import { searchEpisodes } from "@/lib/adaptive-memory/episodic-search";
import { authenticateMcp, createMcpClient } from "@/lib/mcp/auth";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let userId: string;
let otherUserId: string;
let agentId: string;

beforeAll(async () => {
  const [user, other, agent] = await Promise.all([
    db.user.create({ data: { email: `adaptive-${suffix}@example.test` } }),
    db.user.create({ data: { email: `adaptive-other-${suffix}@example.test` } }),
    db.agent.create({ data: { name: `Adaptive ${suffix}`, role: "tester", avatar: "A", color: "#000", model: "test", skills: [], toolPermissions: [] } }),
  ]);
  userId = user.id; otherUserId = other.id; agentId = agent.id;
});

describe("adaptive memory integration", () => {
  it("promotes a verified explicit statement through the firewall and preserves provenance", async () => {
    const result = await proposeMemoryCandidate({
      candidateType: "preference", content: `Use concise release notes ${suffix}`,
      sourceType: "explicit_user_statement", sourceTrust: 0.95, confidence: 0.95,
      importance: 0.6, risk: 0.1, provenance: { sourceIds: [`message-${suffix}`], evidenceIds: [`message-${suffix}`], capturedAt: new Date().toISOString() },
      proposedBy: userId,
    }, userId);
    expect(result.status).toBe("auto_approved");
    expect(result.appliedTargetId).toBeTruthy();
    const object = await db.knowledgeObject.findUnique({ where: { id: result.appliedTargetId! } });
    expect((object?.metadata as { provenance?: { sourceIds?: string[] } }).provenance?.sourceIds).toContain(`message-${suffix}`);
  });

  it("rejects cross-user durable proposals", async () => {
    await expect(proposeMemoryCandidate({
      userId: otherUserId, candidateType: "fact", content: "Cross-user attempt",
      sourceType: "agent_inference", sourceTrust: 0.5, confidence: 0.5, importance: 0.5, risk: 0.4,
      provenance: { sourceIds: ["run"], evidenceIds: ["evidence"], capturedAt: new Date().toISOString() }, proposedBy: agentId,
    }, userId)).rejects.toThrow("Cross-user");
  });

  it("searches full episodic trajectories including tool actions and errors", async () => {
    const run = await db.experience.create({ data: { agentId, actingUserId: userId,
      objective: `Investigate payment timeout ${suffix}`, actionsTaken: [{ tool: "crm.lookup", result: "timeout" }],
      toolsUsed: ["crm.lookup"], outcomeStatus: "failure" } });
    await db.outcome.create({ data: { experienceId: run.id, status: "failure", errors: [{ message: `gateway timeout ${suffix}` }] } });
    const result = await searchEpisodes({ query: "gateway timeout", actorUserId: userId });
    expect(result.experiences.some((item) => item.id === run.id)).toBe(true);
  });

  it("authenticates a short-lived MCP client without storing the plaintext credential", async () => {
    process.env.MCP_CREDENTIAL_PEPPER = `pepper-${suffix}`;
    const { client, credential } = await createMcpClient({ name: `client-${suffix}`, userId,
      scopes: ["knowledge:read"], allowedOrigins: ["https://client.example"],
      expiresAt: new Date(Date.now() + 60_000), createdBy: userId });
    expect(client.credentialHash).not.toContain(credential);
    const context = await authenticateMcp(new Request("https://sentinel.example/mcp", {
      headers: { authorization: `Bearer ${credential}`, origin: "https://client.example" },
    }));
    expect(context.clientId).toBe(client.id);
    expect(context.userId).toBe(userId);
  });
});
