import { z } from "zod";

const bindingsSchema = z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), z.strictObject({
  workspaceId: z.string().min(1),
  endpoint: z.url(),
  label: z.string().min(1).max(100),
  env: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
}));

function configuredBindings() {
  const raw = process.env.MCP_CATALOG_CREDENTIAL_BINDINGS;
  if (!raw) return {};
  try {
    return bindingsSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("MCP credential bindings are misconfigured on Sentinel.");
  }
}

function normalizedEndpoint(raw: string | undefined) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function listMcpCredentialBindings(workspaceId: string) {
  return Object.entries(configuredBindings()).flatMap(([id, binding]) => {
    const endpoint = normalizedEndpoint(binding.endpoint);
    return binding.workspaceId === workspaceId && endpoint
      ? [{ id, label: binding.label, endpoint, configured: Boolean(process.env[binding.env]?.trim()) }]
      : [];
  });
}

export function matchMcpCredentialBinding(id: string, workspaceId: string, endpoint: string) {
  const binding = Object.entries(configuredBindings()).find(([key]) => key === id)?.[1];
  const normalized = normalizedEndpoint(endpoint);
  return binding?.workspaceId === workspaceId && normalized && normalizedEndpoint(binding.endpoint) === normalized
    ? binding.env
    : null;
}

export function isMcpEnvironmentCredentialBound(workspaceId: string, endpoint: string, env: string) {
  const normalized = normalizedEndpoint(endpoint);
  if (!normalized) return false;
  // The bundled MobileOps installer keeps its deployment-owned endpoint and credential.
  if (env === "MOBILEOPS_MCP_TOKEN" && normalized === normalizedEndpoint(process.env.MOBILEOPS_MCP_URL)) {
    if (workspaceId === process.env.MOBILEOPS_MCP_WORKSPACE_ID) return true;
  }
  return Object.values(configuredBindings()).some((binding) =>
    binding.workspaceId === workspaceId && binding.env === env && normalizedEndpoint(binding.endpoint) === normalized,
  );
}
