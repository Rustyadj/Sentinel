/** Verifies scoped graph retrieval against the real database. */
import { db } from "../src/lib/db";
import { getScopedGraph, searchGraphNodes, getNodeDetail } from "../src/lib/graph/scoped";

async function main() {
  // Pick a user who actually owns knowledge objects, so the check exercises
  // real data rather than an empty access scope.
  const owner = await db.knowledgeObject.findFirst({
    where: { userId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  });
  const user = owner?.userId
    ? await db.user.findUnique({ where: { id: owner.userId } })
    : await db.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("no users in this database");
  console.log(`acting as ${user.email}`);

  const entry = await getScopedGraph({ userId: user.id, limit: 50 });
  console.log(`entry view: ${entry.nodes.length} nodes, ${entry.edges.length} edges, partial=${entry.partial}`);

  const capped = await getScopedGraph({ userId: user.id, limit: 10 });
  console.log(`limit honoured: ${capped.nodes.length} <= 10 -> ${capped.nodes.length <= 10}`);

  const filtered = await getScopedGraph({ userId: user.id, limit: 50, types: ["Memory"] });
  const onlyMemory = filtered.nodes.every((node) => node.type === "Memory");
  console.log(`type filter: ${filtered.nodes.length} nodes, all Memory -> ${onlyMemory}`);

  const recent = await getScopedGraph({ userId: user.id, limit: 50, since: new Date(Date.now() - 3_600_000) });
  console.log(`time window (1h): ${recent.nodes.length} nodes`);

  if (entry.nodes.length > 0) {
    const focus = entry.nodes[0];
    const scoped = await getScopedGraph({ userId: user.id, focusId: focus.id, depth: 1, limit: 50 });
    console.log(`focus "${focus.title.slice(0, 40)}": ${scoped.nodes.length} nodes, focusId echoed -> ${scoped.focusId === focus.id}`);
    const detail = await getNodeDetail(user.id, focus.id);
    console.log(`node detail: ${detail.connections.length} readable connections, ${detail.hiddenConnections} hidden`);
    const term = focus.title.trim().split(/\s+/)[0]?.slice(0, 8) ?? "";
    if (term.length >= 2) {
      const found = await searchGraphNodes(user.id, term);
      console.log(`search "${term}": ${found.length} results, focus found -> ${found.some((node) => node.id === focus.id)}`);
    }
  }

  let rejected = false;
  try { await getScopedGraph({ userId: user.id, focusId: "does-not-exist" }); }
  catch (error) { rejected = error instanceof Error && error.message.includes("not found"); }
  console.log(`unknown focus rejected -> ${rejected}`);

  await db.$disconnect();
}

main().catch(async (error) => { console.error(error); process.exitCode = 1; await db.$disconnect(); });
