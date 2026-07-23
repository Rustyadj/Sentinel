import { db } from "@/lib/db";
import { redactSecrets } from "./security";

export interface SecretProvider {
  resolve(reference: string): Promise<string>;
}

export async function executeWithCredential<T>(input: {
  grantId: string; identityType: string; identityId: string; tool: string;
  workspaceId?: string; projectId?: string; provider: SecretProvider;
  execute: (secret: string) => Promise<T>;
}) {
  const grant = await db.credentialGrant.findUniqueOrThrow({ where: { id: input.grantId } });
  if (grant.status !== "active" || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= new Date())) throw new Error("Credential grant is not active.");
  if (grant.identityType !== input.identityType || grant.identityId !== input.identityId || grant.tool !== input.tool) throw new Error("Credential grant scope denied.");
  if (grant.workspaceId && grant.workspaceId !== input.workspaceId) throw new Error("Credential workspace scope denied.");
  if (grant.projectId && grant.projectId !== input.projectId) throw new Error("Credential project scope denied.");
  if (!/^(?:vault|aws-secrets|azure-keyvault|gcp-secret):\/\//.test(grant.secretReference)) throw new Error("Unsupported secret provider reference.");
  const secret = await input.provider.resolve(grant.secretReference);
  try {
    return redactSecrets(await input.execute(secret)) as T;
  } finally {
    // The secret remains function-local and is never returned or persisted.
  }
}
