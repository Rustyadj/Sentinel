import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperationalLenses, OperationalNodeDetails } from "@/modules/graph/components/OperationalLenses";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";
import { nodeColor, GRAPH_COLORS } from "@/lib/graph/theme";
import type { KnowledgeNode } from "@/lib/knowledge/types";
const node: KnowledgeNode = { id: "SYNTHETIC-service", type: "Service", title: "SYNTHETIC gateway", scope: "workspace", createdAt: new Date(), metadata: { operational: true, source: "synthetic-test", eventTime: "2026-09-01T00:00:00Z", facts: { status: "failed" }, evidence: ["https://synthetic.test/evidence"], impact: { status: "predicted", confidence: null, reasons: ["Uncalibrated dependency impact"], evidence: [] } } };
describe("existing graph operational lenses", () => {
  it("renders evidence, uncertainty and predicted impact without inventing confidence", () => {
    render(<OperationalNodeDetails node={node} />);
    expect(screen.getByText(/confidence unknown/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Evidence 1" })).toHaveAttribute("href", "https://synthetic.test/evidence");
    expect(nodeColor(node)).toBe(GRAPH_COLORS.amber);
    const graph = buildLensGraphFromApi({ nodes: [node], edges: [] });
    expect(graph.nodes.find(item => item.id === node.id)?.label).toContain("predicted impact");
    expect(graph.meta.demo).toBe(false);
  });
  it("loads workspace evidence within the current canvas and offers all six lenses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => new Response(JSON.stringify(String(input).startsWith("/api/workspaces") ? { workspaces: [{ id: "synthetic-workspace", name: "SYNTHETIC workspace" }] } : { nodes: [], edges: [], notices: [], teams: [], totalVisible: 0, partial: false, alertAnalytics: { total: 0, actionable: 0, falsePositives: 0, duplicates: 0 } }), { status: 200 }));
    const onGraph = vi.fn();
    render(<OperationalLenses onGraph={onGraph} />);
    expect(screen.getAllByRole("option")).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("Operational lens"), { target: { value: "incident" } });
    await screen.findByRole("option", { name: "SYNTHETIC workspace" });
    fireEvent.change(screen.getByLabelText("Operational workspace"), { target: { value: "synthetic-workspace" } });
    await screen.findByText("No operational evidence recorded in this workspace.");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("workspaceId=synthetic-workspace"), expect.anything());
    await waitFor(() => expect(onGraph).toHaveBeenCalledWith(expect.objectContaining({ nodes: [] })));
    fetchMock.mockRestore();
  });
});
