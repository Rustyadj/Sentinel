// Sentinel Neural Engine — Phase E: skill promotion automation
//
// skill-service.ts (Phase A) has the promotion threshold and the apply path,
// but nothing ever computed real evidence and proposed a candidate — the
// only way to get a Skill was to hand-build a LearningCandidate yourself.
// This file is the automated scanner: it looks at real Experience +
// Evaluation history, groups it by (agent, domain), and — only when the
// group clears every threshold — proposes a `skill` LearningCandidate.
//
// It never creates a Skill directly. `skill`/`procedure` are not on
// policy-service's auto-approve allowlist, so every proposal this scanner
// makes lands as `proposed` and waits for a human, same as any other
// medium/high-risk candidate. "No auto-promoting one successful run" is
// enforced twice over: once by the threshold check here, once by the
// approval gate on the other side.

import { db } from "@/lib/db";
import { coarseDomain } from "./evaluation-service";
import { proposeCandidate } from "./learning-service";
import { checkPromotionEligibility, type PromotionEvidence } from "./skill-service";

const SAFETY_FAILURE_THRESHOLD = 0.5;
/** Only consider experiences from the last N days — stale evidence shouldn't promote a skill today. */
const LOOKBACK_DAYS = 60;

interface DomainGroup {
  agentId: string;
  domain: string;
  experienceIds: string[];
  taskKeys: Set<string>;
  successCount: number;
  total: number;
  representativeObjective: string;
  representativeActions: unknown;
}

async function buildDomainGroups(agentId?: string): Promise<Map<string, DomainGroup>> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const experiences = await db.experience.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      outcomeStatus: { in: ["success", "partial", "failure"] },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      agentId: true,
      objective: true,
      taskId: true,
      outcomeStatus: true,
      actionsTaken: true,
    },
  });

  const groups = new Map<string, DomainGroup>();
  for (const exp of experiences) {
    const domain = coarseDomain(exp.objective);
    const key = `${exp.agentId}::${domain}`;
    const group =
      groups.get(key) ??
      ({
        agentId: exp.agentId,
        domain,
        experienceIds: [],
        taskKeys: new Set<string>(),
        successCount: 0,
        total: 0,
        representativeObjective: exp.objective,
        representativeActions: exp.actionsTaken,
      } satisfies DomainGroup);

    group.experienceIds.push(exp.id);
    group.taskKeys.add(exp.taskId ?? exp.objective);
    group.total += 1;
    if (exp.outcomeStatus === "success") group.successCount += 1;
    groups.set(key, group);
  }

  return groups;
}

async function evidenceForGroup(group: DomainGroup): Promise<PromotionEvidence> {
  const evaluations = await db.evaluation.findMany({
    where: { experienceId: { in: group.experienceIds } },
    select: { confidence: true, safetyScore: true },
  });

  const evaluatorConfidence =
    evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + e.confidence, 0) / evaluations.length
      : 0; // no evaluations at all -> can't claim confidence, fails the threshold honestly

  const hasUnresolvedSafetyFailure = evaluations.some(
    (e) => e.safetyScore != null && e.safetyScore < SAFETY_FAILURE_THRESHOLD,
  );

  return {
    evidenceCount: group.total,
    successRate: group.total > 0 ? group.successCount / group.total : 0,
    distinctTaskCount: group.taskKeys.size,
    evaluatorConfidence,
    hasUnresolvedSafetyFailure,
  };
}

/** Has this (agent, domain) already got an active skill, or a proposal awaiting review? */
async function alreadyCoveredOrPending(agentId: string, domain: string): Promise<boolean> {
  const [existingSkill, pendingCandidate] = await Promise.all([
    db.skill.findFirst({ where: { domain, owner: agentId, status: "active" }, select: { id: true } }),
    db.learningCandidate.findFirst({
      where: {
        type: "skill",
        status: "proposed",
        // Scoped by both domain AND owner — matching on domain alone would let
        // one agent's pending proposal silently block every other agent from
        // ever getting a skill proposed in that same domain.
        AND: [
          { proposedPayload: { path: ["domain"], equals: domain } },
          { proposedPayload: { path: ["owner"], equals: agentId } },
        ],
      },
      select: { id: true },
    }),
  ]);
  return !!existingSkill || !!pendingCandidate;
}

export interface SkillPromotionScanResult {
  groupsScanned: number;
  proposed: string[];
  skippedIneligible: number;
  skippedAlreadyCovered: number;
}

/**
 * Scan recent Experience history (optionally scoped to one agent) and
 * propose `skill` LearningCandidates for every (agent, domain) group that
 * clears the real promotion thresholds and isn't already covered.
 */
export async function scanForPromotableSkills(
  agentId?: string,
): Promise<SkillPromotionScanResult> {
  const groups = await buildDomainGroups(agentId);
  const proposed: string[] = [];
  let skippedIneligible = 0;
  let skippedAlreadyCovered = 0;

  for (const group of groups.values()) {
    if (await alreadyCoveredOrPending(group.agentId, group.domain)) {
      skippedAlreadyCovered++;
      continue;
    }

    const evidence = await evidenceForGroup(group);
    const check = checkPromotionEligibility(evidence);
    if (!check.eligible) {
      skippedIneligible++;
      continue;
    }

    const { candidate } = await proposeCandidate({
      type: "skill",
      proposedPayload: {
        name: `${group.domain} (auto-detected)`,
        description: `Automatically detected from ${group.total} experiences across ${group.taskKeys.size} distinct tasks. Representative objective: "${group.representativeObjective}".`,
        domain: group.domain,
        steps: Array.isArray(group.representativeActions) ? group.representativeActions : [],
        owner: group.agentId,
        evidenceLinks: group.experienceIds.slice(0, 10),
        evidence,
      },
      targetType: "skill",
      evidenceCount: evidence.evidenceCount,
      confidence: evidence.evaluatorConfidence,
      // Redundant with policy-service's allowlist (skill isn't on it), stated
      // explicitly here so the intent reads correctly at the call site.
      riskLevel: "medium",
    });

    proposed.push(candidate.id);
  }

  return {
    groupsScanned: groups.size,
    proposed,
    skippedIneligible,
    skippedAlreadyCovered,
  };
}
