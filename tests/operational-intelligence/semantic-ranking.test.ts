import { describe, expect, it, vi } from "vitest";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";
import { ingestOperationalEvent } from "@/lib/knowledge/operational-ingestion";
import { retrieveIncidentHistory } from "@/lib/knowledge/operational-retrieval";
import { storeEmbedding } from "@/lib/neural-engine/embedding-store";
import * as embeddings from "@/lib/neural-engine/embeddings";
import { syntheticIncident } from "./fixtures";
const vector = (sign: number) => [sign, ...Array.from({ length: 1535 }, () => 0)];
describe("hybrid retrieval using governed pgvector candidates", () => {
  it("ranks matching synthetic vectors and excludes identical vectors in another workspace", async () => {
    const user = await makeUser(), workspace = await makeWorkspace(user.id), other = await makeWorkspace(user.id);
    await ingestOperationalEvent(user.id, workspace.id, syntheticIncident(1, "SYNTHETIC alpha"));
    await ingestOperationalEvent(user.id, workspace.id, syntheticIncident(2, "SYNTHETIC beta"));
    await ingestOperationalEvent(user.id, other.id, syntheticIncident(3, "SYNTHETIC foreign"));
    const initial = await retrieveIncidentHistory({ userId: user.id, workspaceId: workspace.id, query: "incident", maxItems: 20 });
    const foreign = await retrieveIncidentHistory({ userId: user.id, workspaceId: other.id, query: "incident" });
    const provenance = { provider: "openai", model: "synthetic-test-space", version: 1, dimensions: 1536 };
    for (const item of initial.incidents) await storeEmbedding({ ...provenance, memoryId: item.memoryId, vector: vector(item.sourceId.endsWith("1") ? 1 : -1) });
    await storeEmbedding({ ...provenance, memoryId: foreign.incidents[0].memoryId, vector: vector(1) });
    const provider = vi.spyOn(embeddings, "getEmbeddingProvider").mockReturnValue({ name: "openai", model: provenance.model, dimensions: 1536, embed: async () => [vector(1)] });
    const embed = vi.spyOn(embeddings, "embed").mockResolvedValue({ vectors: [vector(1)], modelId: "synthetic-test-space" });
    try {
      const ranked = await retrieveIncidentHistory({ userId: user.id, workspaceId: workspace.id, query: "incident", maxItems: 20 });
      expect(ranked.semanticAvailable).toBe(true);
      expect(ranked.incidents[0].sourceId).toBe("synthetic-incident-1");
      expect(ranked.incidents.some(item => item.sourceId === "synthetic-incident-3")).toBe(false);
      expect((await retrieveIncidentHistory({ userId: user.id, workspaceId: workspace.id, query: "incident", allowedScopes: [] })).incidents).toEqual([]);
    } finally { provider.mockRestore(); embed.mockRestore(); }
  });
});
