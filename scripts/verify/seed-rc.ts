// Seeds the disposable verification database (deploy/verify) with the people, workspaces and graph the
// browser suite signs in as and inspects. Refuses to run against anything but the verification database.
//
//   DATABASE_URL=postgresql://rc:rc-disposable@127.0.0.1:55510/rc npx tsx scripts/verify/seed-rc.ts
//
// Writes the ids it created to $RC_SEED_OUT (default tests/e2e/rc/.seed.json, git-ignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost):55510\/rc$/.test(url)) {
  console.error("Refusing to seed: DATABASE_URL must be the verification database (…@127.0.0.1:55510/rc).");
  process.exit(1);
}

export const RC_PASSWORD = "rc-Test-pass-1!";
const OUT = process.env.RC_SEED_OUT ?? "tests/e2e/rc/.seed.json";

async function main() {
  const { db } = await import("../../src/lib/db");
  const { ensureSystemRoles, ensureMemberAccess } = await import("../../src/lib/workspaces/permissions-catalog");
  const { createBot } = await import("../../src/lib/bots/service");
  const { HERMES_BUILTIN_SERVER_ID } = await import("../../src/lib/bots/catalog");

  const passwordHash = await bcrypt.hash(RC_PASSWORD, 10);
  const user = (email: string, name: string) => db.user.upsert({ where: { email }, update: { passwordHash }, create: { email, name, passwordHash } });
  const owner = await user("owner@rc.test", "Olive Owner");
  const member = await user("member@rc.test", "Mia Member");
  const outsider = await user("outsider@rc.test", "Otto Outsider");

  // Agents are registered against the workspace slug "default" (src/lib/agents/registry.ts).
  const alpha = await db.workspace.upsert({ where: { slug: "default" }, update: { ownerId: owner.id, name: "RC Alpha" }, create: { id: "rc-ws-alpha", slug: "default", name: "RC Alpha", ownerId: owner.id } });
  const bravo = await db.workspace.upsert({ where: { slug: "rc-bravo" }, update: { ownerId: outsider.id }, create: { slug: "rc-bravo", name: "RC Bravo", ownerId: outsider.id } });
  await ensureSystemRoles(alpha.id); await ensureSystemRoles(bravo.id);
  await ensureMemberAccess(alpha.id, member.id);

  const project = (await db.project.findFirst({ where: { workspaceId: alpha.id, name: "RC Project" } })) ?? await db.project.create({ data: { name: "RC Project", userId: owner.id, workspaceId: alpha.id } });

  // A small graph the Orrery has something real to draw. Only the owner's own objects.
  const node = (key: string, type: string, title: string) =>
    db.knowledgeObject.upsert({
      where: { sourceType_sourceId_userId: { sourceType: "rc-seed", sourceId: key, userId: owner.id } },
      update: { title }, create: { type, title, sourceType: "rc-seed", sourceId: key, scope: "user", userId: owner.id },
    });
  const nodes = [await node("n1", "Task", "Pour the north wall"), await node("n2", "Decision", "Use ICF for the basement"), await node("n3", "Memory", "Crew prefers morning pours"), await node("n4", "Agent", "Lisa")];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3]]) {
    await db.knowledgeEdge.upsert({ where: { fromObjectId_toObjectId_type: { fromObjectId: nodes[a].id, toObjectId: nodes[b].id, type: "related_to" } }, update: {}, create: { fromObjectId: nodes[a].id, toObjectId: nodes[b].id, type: "related_to" } });
  }

  // A registered MCP server whose tool the runtime will report under a prefixed name, for canonical-approval checks.
  const provider = await db.mcpServerRegistration.upsert({
    where: { workspaceId_slug: { workspaceId: alpha.id, slug: "creative-provider" } }, update: {},
    create: { workspaceId: alpha.id, slug: "creative-provider", name: "Creative provider", url: "https://provider.invalid/mcp", enabled: true, status: "connected", tools: [{ name: "generate_video", readOnly: false, destructive: false }] },
  });

  const grants = [
    { serverId: HERMES_BUILTIN_SERVER_ID, toolName: "terminal", permission: "approval" as const },
    { serverId: HERMES_BUILTIN_SERVER_ID, toolName: "read_file", permission: "read" as const },
    { serverId: provider.id, toolName: "generate_video", permission: "approval" as const },
  ];
  const baseBot = { runtimeAgentId: "hermes-lisa", status: "active" as const };
  const existing = await db.bot.findFirst({ where: { workspaceId: alpha.id, name: "RC Forge" } });
  const forge = existing ?? (await createBot({ workspaceId: alpha.id, name: "RC Forge", role: "Ad producer", description: "Makes short ads.", ...baseBot }, owner.id, { toolGrants: grants })).valueOf();
  const bravoBot = (await db.bot.findFirst({ where: { workspaceId: bravo.id, name: "RC Bravo Private" } })) ?? await createBot({ workspaceId: bravo.id, name: "RC Bravo Private", role: "Secret", description: "Belongs to another workspace.", ...baseBot }, outsider.id);

  const seed = {
    password: RC_PASSWORD,
    users: { owner: owner.id, member: member.id, outsider: outsider.id },
    workspaces: { alpha: alpha.id, bravo: bravo.id },
    project: project.id,
    mcpProvider: provider.id,
    bots: { forge: (forge as { id: string }).id, bravo: (bravoBot as { id: string }).id },
    graphNodeIds: nodes.map((n) => n.id),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(seed, null, 2));
  console.log(`seeded; ids written to ${OUT}`);
  await db.$disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
