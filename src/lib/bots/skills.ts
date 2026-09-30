// Hermes-compatible skills for bots.
//
// A skill here is a SKILL.md: YAML frontmatter plus a markdown body of
// instructions. Sentinel stores it on the existing Skill table and puts the body
// in a bot's prompt. It is never executed — a skill directory's scripts and
// assets are not fetched, and nothing on this path runs code from a source.
//
// Installation is two steps on purpose. Fetching or pasting a skill creates a
// row with status "proposed", which cannot be assigned to any bot. An admin then
// reads the exact text and approves it, presenting the SHA-256 they reviewed; if
// the stored text has changed since, approval is refused. That is the gate.

import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { assertSafeMcpUrl, McpRegistrationError } from "./catalog";
import { BotConfigError } from "./models";

export const SKILL_DOMAIN = "hermes-skill";
const MAX_SKILL_BYTES = 100_000;

export interface ParsedSkill {
  name: string;
  description: string;
  version: string;
  requiredTools: string[];
  body: string;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];

/** Parse a Hermes SKILL.md. Throws BotConfigError when it is not one. */
export function parseHermesSkill(text: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trimStart());
  if (!match) throw new BotConfigError("Not a Hermes skill: SKILL.md must begin with YAML frontmatter between --- lines.");
  let meta: unknown;
  try { meta = parseYaml(match[1]); } catch { throw new BotConfigError("Skill frontmatter is not valid YAML."); }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new BotConfigError("Skill frontmatter must be a mapping.");
  const fields = meta as Record<string, unknown>;
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const description = typeof fields.description === "string" ? fields.description.trim() : "";
  if (!name) throw new BotConfigError("Skill frontmatter needs a name.");
  if (!description) throw new BotConfigError("Skill frontmatter needs a description.");
  const nested = fields.metadata && typeof fields.metadata === "object" ? (fields.metadata as Record<string, unknown>) : {};
  const hermes = nested.hermes && typeof nested.hermes === "object" ? (nested.hermes as Record<string, unknown>) : {};
  const body = match[2].trim();
  if (!body) throw new BotConfigError("Skill has no instructions after its frontmatter.");
  return {
    name: name.slice(0, 120),
    description: description.slice(0, 1000),
    version: String(fields.version ?? "1"),
    requiredTools: [...new Set([...asStrings(fields.tools), ...asStrings(fields.required_tools), ...asStrings(hermes.required_tools)])].slice(0, 50),
    body,
  };
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** github.com/.../blob/... pages return HTML; the same file is served raw. */
function toRawUrl(url: URL): URL {
  if (url.hostname === "github.com") {
    const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
    if (match) return new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`);
  }
  return url;
}

async function fetchSkillText(rawUrl: string): Promise<{ text: string; url: string }> {
  const url = toRawUrl(await assertSafeMcpUrl(rawUrl).catch((error: unknown) => {
    throw new BotConfigError(error instanceof McpRegistrationError ? error.message : "url is not acceptable");
  }));
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/plain, text/markdown" } });
  if (!response.ok) throw new BotConfigError(`Fetching the skill failed: HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_SKILL_BYTES) throw new BotConfigError("Skill file is too large (limit 100 KB).");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_SKILL_BYTES) throw new BotConfigError("Skill file is too large (limit 100 KB).");
  return { text, url: url.toString() };
}

export type SkillSource = { kind: "url"; url: string } | { kind: "inline"; content: string };

export interface SkillReview {
  skillId: string;
  name: string;
  description: string;
  version: string;
  requiredTools: string[];
  body: string;
  sha256: string;
  source: Record<string, unknown>;
  status: string;
}

/** Step 1: store the skill as "proposed". Nothing is assignable until approveSkill. */
export async function proposeSkill(workspaceId: string, source: SkillSource, actorUserId: string): Promise<SkillReview> {
  const fetched = source.kind === "url" ? await fetchSkillText(source.url) : { text: source.content, url: null };
  if (Buffer.byteLength(fetched.text) > MAX_SKILL_BYTES) throw new BotConfigError("Skill file is too large (limit 100 KB).");
  const parsed = parseHermesSkill(fetched.text);
  const digest = sha256(fetched.text.trim());
  const skill = await db.skill.create({
    data: {
      workspaceId, name: parsed.name, description: parsed.description, domain: SKILL_DOMAIN, format: "hermes-skill-md",
      body: parsed.body, requiredTools: parsed.requiredTools, version: 1, owner: actorUserId, status: "proposed",
      source: { kind: source.kind, url: fetched.url, sha256: digest, bodySha256: sha256(parsed.body), declaredVersion: parsed.version, fetchedAt: new Date().toISOString() },
    },
  });
  await writeAuditLog({ workspaceId, userId: actorUserId, action: "bot.skill_proposed", entityType: "Skill", entityId: skill.id, details: { name: skill.name, source: source.kind, sha256: digest } });
  return toReview(skill);
}

function toReview(skill: { id: string; name: string; description: string; requiredTools: string[]; body: string | null; source: unknown; status: string }): SkillReview {
  const source = (skill.source && typeof skill.source === "object" ? skill.source : {}) as Record<string, unknown>;
  return {
    skillId: skill.id, name: skill.name, description: skill.description,
    version: typeof source.declaredVersion === "string" ? source.declaredVersion : "1",
    requiredTools: skill.requiredTools, body: skill.body ?? "", sha256: typeof source.sha256 === "string" ? source.sha256 : "", source, status: skill.status,
  };
}

/**
 * Step 2: an admin approves the exact text they read. `reviewedSha256` must match
 * the stored digest, so content edited after review cannot ride an old approval.
 */
export async function approveSkill(skillId: string, workspaceId: string, reviewedSha256: string, actorUserId: string): Promise<SkillReview> {
  const skill = await db.skill.findFirst({ where: { id: skillId, workspaceId, format: "hermes-skill-md" } });
  if (!skill) throw new BotConfigError("Skill not found", 404);
  if (skill.status === "active") return toReview(skill);
  const stored = toReview(skill);
  if (!reviewedSha256 || reviewedSha256 !== stored.sha256) throw new BotConfigError("The skill changed since it was reviewed. Review it again before approving.", 409);
  // The digest above covers the text as fetched. This covers what would actually
  // be put in a prompt: if the stored body no longer matches, nobody reviewed it.
  if (stored.source.bodySha256 !== sha256(skill.body ?? "")) throw new BotConfigError("The stored skill body no longer matches what was fetched. Propose it again.", 409);
  const updated = await db.skill.update({ where: { id: skillId }, data: { status: "active", reviewedByUserId: actorUserId, reviewedAt: new Date() } });
  await writeAuditLog({ workspaceId, userId: actorUserId, action: "bot.skill_approved", entityType: "Skill", entityId: skillId, details: { name: skill.name, sha256: stored.sha256 } });
  return toReview(updated);
}

export async function rejectSkill(skillId: string, workspaceId: string, actorUserId: string): Promise<void> {
  const skill = await db.skill.findFirst({ where: { id: skillId, workspaceId, format: "hermes-skill-md" } });
  if (!skill) throw new BotConfigError("Skill not found", 404);
  await db.$transaction([
    db.botSkill.deleteMany({ where: { skillId } }),
    db.skill.update({ where: { id: skillId }, data: { status: "deprecated", reviewedByUserId: actorUserId, reviewedAt: new Date() } }),
  ]);
  await writeAuditLog({ workspaceId, userId: actorUserId, action: "bot.skill_rejected", entityType: "Skill", entityId: skillId, details: { name: skill.name } });
}

export interface SkillListing {
  id: string; name: string; description: string; version: string; status: string; format: string;
  requiredTools: string[]; source: Record<string, unknown>; sha256: string; assignedBotIds: string[];
}

export async function listWorkspaceSkills(workspaceId: string): Promise<SkillListing[]> {
  const rows = await db.skill.findMany({ where: { workspaceId, domain: SKILL_DOMAIN, status: { in: ["proposed", "active"] } }, include: { botSkills: { select: { botId: true } } }, orderBy: { updatedAt: "desc" } });
  return rows.map((row) => {
    const review = toReview(row);
    return { id: row.id, name: row.name, description: row.description, version: review.version, status: row.status, format: row.format, requiredTools: row.requiredTools, source: review.source, sha256: review.sha256, assignedBotIds: row.botSkills.map((link) => link.botId) };
  });
}

export async function getSkillReview(skillId: string, workspaceId: string): Promise<SkillReview> {
  const skill = await db.skill.findFirst({ where: { id: skillId, workspaceId } });
  if (!skill) throw new BotConfigError("Skill not found", 404);
  return toReview(skill);
}
