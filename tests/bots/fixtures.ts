import { db } from "@/lib/db";
import { HOST } from "./fake-runtime";
import type { CreateBotInput } from "@/lib/bots/schema";

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}`;

export async function makeWorkspace() {
  const id = unique();
  const owner = await db.user.create({ data: { email: `bots-owner-${id}@test.sentinel` } });
  const workspace = await db.workspace.create({ data: { slug: `bots-ws-${id}`, name: `Bots ${id}`, ownerId: owner.id } });
  return { owner, workspace };
}

export async function makeOutsider() {
  return db.user.create({ data: { email: `bots-outsider-${unique()}@test.sentinel` } });
}

export const botInput = (workspaceId: string, over: Partial<CreateBotInput> = {}): CreateBotInput => ({
  workspaceId, name: `Bot ${unique()}`, role: "Tester", runtimeAgentId: HOST.agentId, description: "A bot for tests.",
  ...over,
});

export async function makeExternalClient(userId: string) {
  return db.externalClient.create({ data: { clientId: `client-${unique()}`, name: "Test client", redirectUris: [], allowedScopes: [], createdByUserId: userId } });
}
