/**
 * Workforce roles. A role is a responsibility and a tool allowlist, not a new
 * agent: work that needs a model is delegated through the existing
 * orchestration router (src/lib/orchestration/service.ts), which picks a real
 * registered agent. Existing agent identities (Lisa, Nathan2, Claude Code,
 * Codex ...) are untouched.
 *
 * A step may only use a tool its role allows; the engine enforces this on
 * every execution, so a plan cannot hand a role a capability it lacks.
 */
export interface WorkforceRole {
  key: string;
  name: string;
  responsibilities: string;
  tools: readonly string[];
}

export const WORKFORCE_ROLES: readonly WorkforceRole[] = [
  { key: "executive_orchestrator", name: "Executive Orchestrator", responsibilities: "Planning, delegation, supervision and progress tracking.", tools: ["intake.validate", "report.compile"] },
  { key: "business_operations", name: "Business Operations", responsibilities: "Business setup, administrative workflows, compliance preparation.", tools: ["intake.validate"] },
  { key: "it_administrator", name: "IT Administrator", responsibilities: "Domains, DNS, business email, hosting, account provisioning.", tools: ["domain.check_availability", "domain.register", "email.provision", "dns.configure_email", "dns.verify_email", "hosting.configure", "website.deploy"] },
  { key: "marketing_director", name: "Marketing Director", responsibilities: "SEO, advertising, content, analytics and campaigns.", tools: ["analytics.configure", "agent.marketing_assets"] },
  { key: "sales_agent", name: "Sales Agent", responsibilities: "CRM setup, lead management, outreach preparation.", tools: ["crm.setup"] },
  { key: "finance_agent", name: "Finance Agent", responsibilities: "Budgeting, expense tracking, invoicing, reporting.", tools: [] },
  { key: "software_engineer", name: "Software Engineer", responsibilities: "Coding, integrations, deployment, maintenance.", tools: ["agent.website"] },
  { key: "quality_assurance", name: "Quality Assurance", responsibilities: "Independent verification of agent outputs.", tools: ["qa.verify_deliverables"] },
];

export function getRole(key: string): WorkforceRole | undefined {
  return WORKFORCE_ROLES.find((role) => role.key === key);
}

export function roleAllowsTool(roleKey: string, toolKey: string): boolean {
  return getRole(roleKey)?.tools.includes(toolKey) ?? false;
}
