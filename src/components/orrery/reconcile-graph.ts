// Keeps the Orrery's graph in step with the server's. The old merge only ever
// added: a node whose title changed kept the old one, and a node or edge that was
// deleted (or superseded, or became unreadable) stayed on the globe until the page
// was reloaded. This module is the pure part of fixing that, so it can be tested
// without a browser.
//
// There are two kinds of read:
//   * the BASE read — the newest N readable objects. When the server says it is
//     not partial, it is the whole readable graph and is authoritative.
//   * FOCUS reads — a node an agent or event points at that the base read did not
//     include, fetched with its neighbourhood. Each one is kept as its own payload
//     so it can be re-checked, replaced, or dropped on its own.

export interface ApiNode { id: string; type: string; title: string; workspaceId?: string | null }
export interface ApiEdge { id?: string; fromObjectId: string; toObjectId: string; weight?: number; type?: string }
export interface ScopedPayload { nodes: ApiNode[]; edges: ApiEdge[]; partial?: boolean; totalVisible?: number }

export interface GraphStore {
  base: ScopedPayload;
  focus: Map<string, ScopedPayload>;
}

export const edgeKey = (e: ApiEdge) => e.id ?? `${e.fromObjectId}>${e.toObjectId}:${e.type ?? ""}`;

export const emptyStore = (): GraphStore => ({ base: { nodes: [], edges: [] }, focus: new Map() });

/** Replace the base read. A complete one makes every focus read redundant; a partial one cannot, so they stay until re-checked. */
export function applyBaseRead(store: GraphStore, payload: ScopedPayload): void {
  store.base = { nodes: payload.nodes, edges: payload.edges, partial: payload.partial, totalVisible: payload.totalVisible };
  if (!payload.partial) store.focus.clear();
}

/** Record (or replace) what a focus read returned for one node. */
export function applyFocusRead(store: GraphStore, focusId: string, payload: ScopedPayload): void {
  store.focus.set(focusId, payload);
}

/** The focus node is gone, or no longer readable. */
export function dropFocus(store: GraphStore, focusId: string): void {
  store.focus.delete(focusId);
}

export interface ComposedGraph { nodes: ApiNode[]; edges: ApiEdge[] }

/** What the globe should draw: the base read plus any focus reads, with no edge pointing at a node that is not there. */
export function composeGraph(store: GraphStore): ComposedGraph {
  const nodes = new Map<string, ApiNode>();
  for (const n of store.base.nodes) nodes.set(n.id, n);
  for (const payload of store.focus.values()) for (const n of payload.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const edges = new Map<string, ApiEdge>();
  for (const e of [...store.base.edges, ...[...store.focus.values()].flatMap((p) => p.edges)]) {
    if (nodes.has(e.fromObjectId) && nodes.has(e.toObjectId)) edges.set(edgeKey(e), e);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Changes whenever anything the globe shows would change: ids, labels, types, scope, links, weights. */
export function graphSignature(graph: ComposedGraph): string {
  const nodes = graph.nodes.map((n) => `${n.id}|${n.type}|${n.title}|${n.workspaceId ?? ""}`).sort();
  const edges = graph.edges.map((e) => `${edgeKey(e)}|${e.weight ?? ""}`).sort();
  return `${nodes.join("\n")}\n--\n${edges.join("\n")}`;
}
