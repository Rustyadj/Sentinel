import type { ObjectivePlan, PlannedStep } from "./types";

/**
 * Goal interpretation and planning.
 *
 * Deliberately deterministic: a goal is matched to a vetted plan template and
 * the template's essential inputs are extracted from the text (or supplied
 * explicitly). The plan is fixed at this point. Nothing a step later reads —
 * web pages, RDAP replies, agent output — can add, remove or alter steps, which
 * is the core prompt-injection boundary of the engine (docs/OBJECTIVES.md).
 */

export const BUSINESS_SETUP_TEMPLATE = "business_setup_v1";

export interface BusinessSetupInputs {
  businessName: string;
  domains: string[];
  description: string | null;
}

export type PlanResult =
  | { ok: true; plan: ObjectivePlan }
  | { ok: false; reason: "no_template"; message: string }
  | { ok: false; reason: "missing_inputs"; missing: { field: string; question: string }[] };

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(domain) ? domain : null;
}

export function slugForDomain(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 60);
}

function matchesBusinessSetup(goal: string): boolean {
  const text = goal.toLowerCase();
  return /\b(business|company|startup|brand)\b/.test(text) && /\b(domain|email|website|site|crm|set ?up|create|launch|start)\b/.test(text);
}

function extractBusinessName(goal: string): string | null {
  const match = goal.match(/\b(?:called|named)\s+["“']?([A-Z0-9][\w&'’ -]{1,60}?)["”']?(?=[.,;:!?]|\s+(?:and|with|to|that|which)\b|$)/);
  return match ? match[1].trim() : null;
}

function extractDomains(goal: string): string[] {
  const found = goal.match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,63}\b/gi) ?? [];
  return [...new Set(found.map((d) => normalizeDomain(d)).filter((d): d is string => Boolean(d)))];
}

export interface PlanRequest {
  goal: string;
  businessName?: string;
  domains?: string[];
  description?: string;
}

export function planObjective(request: PlanRequest): PlanResult {
  const goal = request.goal.trim();
  if (!matchesBusinessSetup(goal) && !request.businessName) {
    return { ok: false, reason: "no_template", message: "Sentinel can currently plan one kind of objective: setting up a new business and its digital infrastructure. Describe the business you want to set up." };
  }
  const businessName = (request.businessName?.trim() || extractBusinessName(goal) || "").slice(0, 80);
  if (!businessName) {
    return { ok: false, reason: "missing_inputs", missing: [{ field: "businessName", question: "What is the business called?" }] };
  }
  const explicit = (request.domains ?? []).map(normalizeDomain).filter((d): d is string => Boolean(d));
  const fromGoal = extractDomains(goal);
  const slug = slugForDomain(businessName);
  const derived = slug ? [`${slug}.com`] : [];
  const domains = [...new Set([...explicit, ...fromGoal, ...(explicit.length || fromGoal.length ? [] : derived)])].slice(0, 5);
  if (!domains.length) {
    return { ok: false, reason: "missing_inputs", missing: [{ field: "domains", question: "Which domain name should the business use?" }] };
  }
  const inputs: BusinessSetupInputs = { businessName, domains, description: request.description?.trim().slice(0, 2000) || null };
  return { ok: true, plan: businessSetupPlan(inputs) };
}

export function businessSetupPlan(inputs: BusinessSetupInputs): ObjectivePlan {
  const step = (s: PlannedStep) => s;
  const steps: PlannedStep[] = [
    step({ key: "intake", title: "Confirm essential business details", role: "business_operations", kind: "tool", toolKey: "intake.validate", input: {}, dependsOn: [], impact: "read" }),
    step({ key: "domain_check", title: "Check domain availability", role: "it_administrator", kind: "tool", toolKey: "domain.check_availability", input: { domains: inputs.domains }, dependsOn: ["intake"], impact: "read", maxAttempts: 4 }),
    step({ key: "domain_register", title: "Register the approved domain", role: "it_administrator", kind: "tool", toolKey: "domain.register", input: {}, dependsOn: ["domain_check"], impact: "financial", estimatedCostCents: 2000 }),
    step({ key: "email_provision", title: "Provision business email", role: "it_administrator", kind: "tool", toolKey: "email.provision", input: {}, dependsOn: ["domain_register"], impact: "financial", estimatedCostCents: 600 }),
    step({ key: "dns_email", title: "Configure MX, SPF, DKIM and DMARC records", role: "it_administrator", kind: "tool", toolKey: "dns.configure_email", input: {}, dependsOn: ["domain_register", "email_provision"], impact: "write" }),
    step({ key: "dns_verify", title: "Verify DNS and email configuration", role: "it_administrator", kind: "verify", toolKey: "dns.verify_email", input: {}, dependsOn: ["dns_email"], impact: "read", maxAttempts: 6 }),
    step({ key: "hosting", title: "Configure website hosting", role: "it_administrator", kind: "tool", toolKey: "hosting.configure", input: {}, dependsOn: ["domain_register"], impact: "write" }),
    step({ key: "website_build", title: "Generate the initial website", role: "software_engineer", kind: "agent", toolKey: "agent.website", input: {}, dependsOn: ["intake"], impact: "write" }),
    step({ key: "website_deploy", title: "Deploy the website", role: "it_administrator", kind: "tool", toolKey: "website.deploy", input: {}, dependsOn: ["hosting", "website_build"], impact: "publish" }),
    step({ key: "analytics", title: "Connect analytics and search tools", role: "marketing_director", kind: "tool", toolKey: "analytics.configure", input: {}, dependsOn: ["website_deploy"], impact: "write" }),
    step({ key: "crm", title: "Set up a CRM", role: "sales_agent", kind: "tool", toolKey: "crm.setup", input: {}, dependsOn: ["intake"], impact: "write" }),
    step({ key: "marketing_assets", title: "Prepare initial marketing assets", role: "marketing_director", kind: "agent", toolKey: "agent.marketing_assets", input: {}, dependsOn: ["intake"], impact: "write" }),
  ];
  steps.push({
    key: "qa", title: "Independently verify deliverables", role: "quality_assurance", kind: "verify", toolKey: "qa.verify_deliverables",
    input: {}, dependsOn: steps.map((s) => s.key), impact: "read",
  });
  return { templateKey: BUSINESS_SETUP_TEMPLATE, title: `Set up ${inputs.businessName}`, inputs: { ...inputs }, steps };
}

/** Steps that run once their dependencies have settled, whether or not they succeeded. */
export const RUNS_AFTER_SETTLED_DEPENDENCIES = new Set(["qa.verify_deliverables"]);

/** Throws if the plan's graph is not a DAG over its own keys. */
export function assertValidPlan(plan: ObjectivePlan): void {
  const keys = new Set(plan.steps.map((s) => s.key));
  if (keys.size !== plan.steps.length) throw new Error("Plan has duplicate step keys.");
  for (const s of plan.steps) for (const dep of s.dependsOn) if (!keys.has(dep)) throw new Error(`Step ${s.key} depends on unknown step ${dep}.`);
  const state = new Map<string, 1 | 2>();
  const byKey = new Map(plan.steps.map((s) => [s.key, s]));
  const visit = (key: string) => {
    if (state.get(key) === 2) return;
    if (state.get(key) === 1) throw new Error(`Plan has a dependency cycle through ${key}.`);
    state.set(key, 1);
    for (const dep of byKey.get(key)!.dependsOn) visit(dep);
    state.set(key, 2);
  };
  for (const key of keys) visit(key);
}
