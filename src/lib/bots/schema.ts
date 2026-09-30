import { z } from "zod";

/** Memory scopes a bot's policy may name. `bot` is private to one bot; the rest are Sentinel's own. */
export const MEMORY_SCOPES = ["bot", "session", "project", "workspace", "organization", "user", "global"] as const;
export type BotMemoryScope = (typeof MEMORY_SCOPES)[number];

export const TOOL_PERMISSIONS = ["disabled", "read", "execute", "approval"] as const;
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

export const BOT_STATUSES = ["draft", "active", "disabled"] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

/** Hard ceiling on delegation depth regardless of what any policy asks for. */
export const MAX_DELEGATION_DEPTH = 3;

const modelId = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/, "use a provider model id (1–128 characters)");

export const modelConfigSchema = z.object({
  primary: modelId.optional(),
  fast: modelId.optional(),
  reasoning: modelId.optional(),
  vision: modelId.optional(),
  fallback: modelId.optional(),
  effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).nullable().optional(),
  /** Bounds the memory/context block Sentinel puts in front of this bot. */
  maxContextTokens: z.number().int().min(500).max(200_000).optional(),
}).strict();
export type BotModelConfig = z.infer<typeof modelConfigSchema>;

export const memoryPolicySchema = z.object({
  enabled: z.boolean().default(true),
  readScopes: z.array(z.enum(MEMORY_SCOPES)).max(MEMORY_SCOPES.length).default(["bot", "project"]),
  writeScopes: z.array(z.enum(MEMORY_SCOPES)).max(MEMORY_SCOPES.length).default(["bot"]),
  maxItems: z.number().int().min(1).max(50).default(8),
  /** 0–1. Memories ranked below this are not shown to the bot. */
  minRelevance: z.number().min(0).max(1).default(0),
  /** standard: writes are reconsolidated against existing beliefs. off: stored as observed. */
  consolidation: z.enum(["standard", "off"]).default("standard"),
  /** Days a memory this bot writes stays retrievable. null = Sentinel's normal decay policy. */
  retentionDays: z.number().int().min(1).max(3650).nullable().default(null),
}).strict();
export type BotMemoryPolicy = z.infer<typeof memoryPolicySchema>;

export const delegationPolicySchema = z.object({
  /** user | user:<id> | agent:<agentId> | client:<externalClientId>. Empty denies every caller. */
  allowedCallers: z.array(z.string().trim().min(1).max(160)).max(50).default(["user"]),
  /** Bot ids this bot may itself delegate to. Only consulted when canDelegate. */
  allowedChildBots: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  canDelegate: z.boolean().default(false),
  maxDepth: z.number().int().min(1).max(MAX_DELEGATION_DEPTH).default(1),
}).strict();
export type BotDelegationPolicy = z.infer<typeof delegationPolicySchema>;

export const limitsSchema = z.object({
  maxConcurrentTasks: z.number().int().min(1).max(20).default(2),
  maxTokensPerTask: z.number().int().min(1_000).max(10_000_000).nullable().default(null),
  maxTokensPerDay: z.number().int().min(1_000).max(1_000_000_000).nullable().default(null),
  maxCostPerDay: z.number().min(0.01).max(100_000).nullable().default(null),
}).strict();
export type BotLimits = z.infer<typeof limitsSchema>;

export const workflowStepSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  /** deterministic and tool steps are done by code or a tool, not by the model. */
  kind: z.enum(["llm", "tool", "deterministic"]),
  note: z.string().trim().max(400).optional(),
}).strict();
export type BotWorkflowStep = z.infer<typeof workflowStepSchema>;

const shortText = (max: number) => z.string().trim().max(max);
const list = (max: number, itemMax: number) => z.array(z.string().trim().min(1).max(itemMax)).max(max);

export const botFieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.string().trim().min(1).max(100),
  description: shortText(1000).default(""),
  avatar: z.string().trim().min(1).max(40).default("bot"),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#7c6cf6"),
  tags: list(12, 30).default([]),
  templateId: z.string().trim().max(60).nullable().optional(),
  systemPrompt: shortText(12_000).default(""),
  mission: shortText(2_000).default(""),
  responsibilities: list(30, 300).default([]),
  constraints: list(30, 300).default([]),
  outputPreferences: shortText(2_000).default(""),
  workflow: z.array(workflowStepSchema).max(30).default([]),
  capabilities: list(30, 60).default([]),
  runtimeAgentId: z.string().trim().min(1).max(100),
  modelConfig: modelConfigSchema.default({}),
  memoryPolicy: memoryPolicySchema.default(() => memoryPolicySchema.parse({})),
  delegationPolicy: delegationPolicySchema.default(() => delegationPolicySchema.parse({})),
  limits: limitsSchema.default(() => limitsSchema.parse({})),
});
export type BotFieldsInput = z.input<typeof botFieldsSchema>;
export type BotFields = z.output<typeof botFieldsSchema>;

export const createBotSchema = botFieldsSchema.extend({
  workspaceId: z.string().trim().min(1).max(100),
  /** New bots are drafts unless the creator says otherwise; only active bots are discoverable. */
  status: z.enum(BOT_STATUSES).default("draft"),
});
export type CreateBotInput = z.input<typeof createBotSchema>;

export const updateBotSchema = botFieldsSchema.partial().extend({
  status: z.enum(BOT_STATUSES).optional(),
});
export type UpdateBotInput = z.input<typeof updateBotSchema>;

export const grantToolSchema = z.object({
  serverId: z.string().trim().min(1).max(100),
  toolName: z.string().trim().min(1).max(200).default("*"),
  permission: z.enum(TOOL_PERMISSIONS),
});
export type GrantToolInput = z.input<typeof grantToolSchema>;

export const delegateTaskSchema = z.object({
  task: z.string().trim().min(1).max(12_000),
  /** Creative brief / project context the caller wants the bot to have. Passed as-is; never trusted as instructions about permissions. */
  context: z.string().trim().max(20_000).optional(),
  projectId: z.string().trim().max(100).optional(),
  workspaceId: z.string().trim().max(100).optional(),
  modelRole: z.enum(["primary", "fast", "reasoning", "vision"]).default("primary"),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  /** Set when a running bot task is delegating to a child bot. */
  parentTaskId: z.string().trim().max(100).optional(),
});
export type DelegateTaskInput = z.input<typeof delegateTaskSchema>;

/** Status vocabulary exposed to callers. Storage keeps OrchestrationRun's own values. */
export const BOT_TASK_STATUSES = ["QUEUED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type BotTaskStatus = (typeof BOT_TASK_STATUSES)[number];

export function toBotTaskStatus(runStatus: string): BotTaskStatus {
  switch (runStatus) {
    case "queued": return "QUEUED";
    case "running":
    case "cancelling": return "RUNNING";
    case "waiting": return "WAITING";
    case "succeeded": return "COMPLETED";
    case "cancelled": return "CANCELLED";
    default: return "FAILED";
  }
}

export function slugify(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "bot";
}
