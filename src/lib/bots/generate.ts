// "Generate Bot Instructions": turn a one-line description into a proposed bot.
//
// The proposal is text for a person to read and edit. Nothing it names is
// created or granted: suggested tools are filtered to ones that exist in the
// catalog and come back marked as suggestions, and the wizard leaves them
// unticked. The model runs through a real Hermes runtime; if none is ready this
// fails with that reason rather than returning invented output.

import { z } from "zod";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getAdapterForRuntime } from "@/lib/agents/runtime/service";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { loadCatalog } from "./catalog";
import { BotConfigError, listBotHosts } from "./models";
import { botFieldsSchema, workflowStepSchema, type ToolPermission } from "./schema";
import { SKILL_DOMAIN } from "./skills";

const GENERATION_TIMEOUT_MS = 120_000;

export interface SuggestedGrantProposal { serverId: string; serverName: string; toolName: string; permission: ToolPermission; why: string }

export interface BotProposal {
  fields: {
    name: string; role: string; description: string; systemPrompt: string; mission: string;
    responsibilities: string[]; constraints: string[]; outputPreferences: string;
    workflow: z.infer<typeof workflowStepSchema>[]; capabilities: string[]; tags: string[];
  };
  suggestedGrants: SuggestedGrantProposal[];
  suggestedSkills: { id: string; name: string }[];
  /** Things the model suggested that Sentinel could not match to anything real. */
  dropped: string[];
  hostAgentId: string;
}

const proposalSchema = z.object({
  name: botFieldsSchema.shape.name,
  role: botFieldsSchema.shape.role,
  description: botFieldsSchema.shape.description,
  systemPrompt: botFieldsSchema.shape.systemPrompt,
  mission: botFieldsSchema.shape.mission,
  responsibilities: botFieldsSchema.shape.responsibilities,
  constraints: botFieldsSchema.shape.constraints,
  outputPreferences: botFieldsSchema.shape.outputPreferences,
  workflow: botFieldsSchema.shape.workflow,
  capabilities: botFieldsSchema.shape.capabilities,
  tags: botFieldsSchema.shape.tags,
  tools: z.array(z.object({ server: z.string(), tool: z.string().default("*"), permission: z.enum(["read", "execute", "approval"]).default("read"), why: z.string().default("") })).max(40).default([]),
  skills: z.array(z.string()).max(20).default([]),
});

/** The first balanced JSON object in the text, tolerating prose or code fences around it. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new BotConfigError("The model did not return a bot definition.", 502);
  let depth = 0; let inString = false; let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === "\"") inString = false; continue; }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, index + 1)); } catch { throw new BotConfigError("The model returned malformed JSON.", 502); }
    }
  }
  throw new BotConfigError("The model's bot definition was cut off.", 502);
}

export function buildGenerationPrompt(description: string, catalog: { name: string; tools: string[] }[], skills: string[]): string {
  return [
    "You are configuring a specialised AI bot for Sentinel OS. Respond with ONE JSON object and nothing else. Do not call any tools.",
    "Fields: name (short), role, description, systemPrompt, mission, responsibilities[], constraints[], outputPreferences, workflow[{id,label,kind:'llm'|'tool'|'deterministic',note?}], capabilities[] (lowercase-hyphenated tags), tags[], tools[{server,tool,permission:'read'|'execute'|'approval',why}], skills[].",
    "Rules: grant the fewest tools that make the job possible, prefer 'read', and use 'approval' for anything that spends money or publishes. Use only servers and tools from the catalog below. Do not invent tools. Use deterministic workflow steps wherever code or a tool can do the work instead of the model.",
    `Catalog:\n${catalog.map((server) => `- ${server.name}: ${server.tools.slice(0, 40).join(", ") || "(no tools discovered)"}`).join("\n")}`,
    `Available skills: ${skills.join(", ") || "(none)"}`,
    `The user's description of the bot:\n<description>\n${description}\n</description>`,
  ].join("\n\n");
}

async function pickHost(preferred?: string) {
  const hosts = await listBotHosts();
  const candidates = hosts.filter((host) => host.executionVerified && (!preferred || host.agentId === preferred));
  for (const host of candidates) {
    const { adapter } = await getAdapterForRuntime(host.agentId);
    const readiness = await adapter.readiness(asRuntimeInstance(host)).catch(() => ({ ready: false as const, reason: "unreachable" }));
    if (readiness.ready) return host;
  }
  throw new BotConfigError(
    preferred ? `Host ${preferred} is not ready, so instructions cannot be generated right now.` : "No verified Hermes runtime is ready, so instructions cannot be generated right now. You can still start from a template.",
    503,
  );
}

export async function generateBotProposal(input: { description: string; workspaceId: string; userId: string; hostAgentId?: string }): Promise<BotProposal> {
  const description = input.description.trim();
  if (description.length < 10) throw new BotConfigError("Describe the bot in at least a sentence.");
  if (description.length > 2000) throw new BotConfigError("Keep the description under 2000 characters.");

  const host = await pickHost(input.hostAgentId);
  const catalog = await loadCatalog(input.workspaceId);
  const skills = await db.skill.findMany({ where: { workspaceId: input.workspaceId, domain: SKILL_DOMAIN, status: "active" }, select: { id: true, name: true } });
  const prompt = buildGenerationPrompt(description, catalog.filter((server) => server.enabled).map((server) => ({ name: server.name, tools: server.tools.map((tool) => tool.name) })), skills.map((skill) => skill.name));

  const { adapter, runtime } = await getAdapterForRuntime(host.agentId);
  const session = await adapter.startSession({ runtimeId: runtime.id, userId: input.userId, workspaceId: input.workspaceId });
  let text = "";
  const deadline = setTimeout(() => { void adapter.cancel(session.id); }, GENERATION_TIMEOUT_MS);
  try {
    for await (const event of adapter.send({ sessionId: session.id, userId: input.userId, prompt })) {
      if (event.type === "assistant_delta" && typeof event.data.text === "string") text += event.data.text;
      // Generating a definition needs no tools. A call means the runtime is going off-task, so stop it.
      if (event.type === "tool_started" || event.type === "approval_required") {
        await adapter.cancel(session.id);
        throw new BotConfigError("The model tried to use a tool while generating a definition, so it was stopped. Try again, or start from a template.", 502);
      }
      if (event.type === "error") throw new BotConfigError("The runtime reported an error while generating the definition.", 502);
    }
  } finally {
    clearTimeout(deadline);
  }
  if (!text.trim()) throw new BotConfigError("The runtime returned nothing. Try again, or start from a template.", 502);

  const parsed = proposalSchema.safeParse(extractJsonObject(text));
  if (!parsed.success) throw new BotConfigError(`The model's definition was not usable: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, 502);
  const proposal = parsed.data;

  const dropped: string[] = [];
  const suggestedGrants: SuggestedGrantProposal[] = [];
  for (const wanted of proposal.tools) {
    const wantedName = wanted.server.trim().toLowerCase();
    const server = catalog.find((entry) => entry.enabled && (entry.name.toLowerCase() === wantedName || entry.slug === wantedName || entry.id === wanted.server));
    if (!server) { dropped.push(`server "${wanted.server}"`); continue; }
    if (wanted.tool !== "*" && !server.tools.some((tool) => tool.name === wanted.tool)) { dropped.push(`${server.name}: ${wanted.tool}`); continue; }
    suggestedGrants.push({ serverId: server.id, serverName: server.name, toolName: wanted.tool, permission: wanted.permission, why: wanted.why.slice(0, 200) });
  }
  const suggestedSkills: BotProposal["suggestedSkills"] = [];
  for (const name of proposal.skills) {
    const found = skills.find((skill) => skill.name.toLowerCase() === name.trim().toLowerCase());
    if (found) suggestedSkills.push(found); else dropped.push(`skill "${name}"`);
  }
  await writeAuditLog({ workspaceId: input.workspaceId, userId: input.userId, action: "bot.instructions_generated", entityType: "Bot", details: { host: host.agentId, suggestedGrants: suggestedGrants.length, dropped: dropped.length } });
  const { tools: _tools, skills: _skills, ...fields } = proposal;
  void _tools; void _skills;
  return { fields, suggestedGrants, suggestedSkills, dropped, hostAgentId: host.agentId };
}
