import { z } from "zod";

const label = z.string().trim().min(1).max(120);
const details = z.string().trim().min(1).max(2_000);
const key = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

export const specialistSchema = z.strictObject({
  key,
  name: label,
  specialization: label,
  personality: details,
  communicationStyle: label,
  responsibilities: z.array(details).min(1).max(10),
  reportsTo: key.nullable(),
  objectives: z.array(z.strictObject({
    goal: details,
    metric: details,
    cadence: z.enum(["once", "daily", "weekly", "monthly"]),
  })).min(1).max(10),
  requestedCapabilities: z.array(label).max(20),
});

export const workforcePlanSchema = z.strictObject({
  department: z.strictObject({ name: label, description: details }),
  specialists: z.array(specialistSchema).min(1).max(20),
}).superRefine(({ specialists }, ctx) => {
  const agents = new Map(specialists.map((agent) => [agent.key, agent]));
  if (agents.size !== specialists.length) {
    ctx.addIssue({ code: "custom", path: ["specialists"], message: "Agent keys must be unique." });
  }
  for (const [index, specialist] of specialists.entries()) {
    const seen = new Set([specialist.key]);
    let manager = specialist.reportsTo;
    while (manager) {
      const path = ["specialists", index, "reportsTo"];
      const match = agents.get(manager);
      if (!match || seen.has(manager)) {
        ctx.addIssue({ code: "custom", path, message: match ? "Reporting relationships must be acyclic." : "Reporting manager must belong to this plan." });
        break;
      }
      seen.add(manager);
      manager = match.reportsTo;
    }
  }
});

export type WorkforcePlan = z.infer<typeof workforcePlanSchema>;

export function marketingPlan(organization: string): WorkforcePlan {
  return {
    department: {
      name: "Marketing",
      description: `Grow qualified construction demand and sharpen market positioning for ${organization}.`,
    },
    specialists: [
      { key: "leads", name: "Morgan", specialization: "Construction Lead Research", personality: "Curious and evidence-driven.", communicationStyle: "Brief, sourced prospect notes.", responsibilities: ["Research qualified construction leads and cite their sources."], reportsTo: "reporting", objectives: [{ goal: "Publish a qualified construction lead list.", metric: "Qualified leads with verified sources and fit criteria.", cadence: "weekly" }], requestedCapabilities: ["public web research", "CRM"] },
      { key: "seo", name: "Sasha", specialization: "SEO Strategy", personality: "Analytical and methodical.", communicationStyle: "Prioritized recommendations with rationale.", responsibilities: ["Audit search visibility and prioritize on-page improvements."], reportsTo: "reporting", objectives: [{ goal: "Deliver an actionable search audit.", metric: "Evidence-backed SEO improvements prioritized by impact.", cadence: "weekly" }], requestedCapabilities: ["website analytics", "public web research"] },
      { key: "content", name: "Avery", specialization: "Content Production", personality: "Inquisitive and clear.", communicationStyle: "Practical, audience-specific drafts.", responsibilities: ["Draft construction marketing content and fact-check claims."], reportsTo: "reporting", objectives: [{ goal: "Prepare a review-ready content package.", metric: "Drafts with verified claims, audience and distribution notes.", cadence: "weekly" }], requestedCapabilities: ["document editing"] },
      { key: "competition", name: "Riley", specialization: "Competitive Intelligence", personality: "Observant and skeptical.", communicationStyle: "Concise changes with citations.", responsibilities: ["Monitor public competitor activity and flag substantive market changes."], reportsTo: "reporting", objectives: [{ goal: "Deliver a competitor change brief.", metric: "Material changes verified against public sources.", cadence: "weekly" }], requestedCapabilities: ["public web research"] },
      { key: "reporting", name: "Jordan", specialization: "Marketing Operations and Reporting", personality: "Organized and decisive.", communicationStyle: "Executive summaries with evidence and next actions.", responsibilities: ["Coordinate specialists and synthesize work into weekly reports."], reportsTo: null, objectives: [{ goal: "Deliver the weekly marketing report.", metric: "Reports covering leads, SEO, content, competitors and next actions.", cadence: "weekly" }], requestedCapabilities: ["document editing", "agent delegation"] },
    ],
  };
}
