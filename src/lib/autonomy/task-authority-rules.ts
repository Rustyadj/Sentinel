import { operationForActionClass, type AuthorityOperation } from "./authority";

/**
 * Standing delegation for collaboration-room tasks (lisa-loop.ts gates).
 *
 * Keyword escalation (approval-gate.ts assessRisk) never decides by itself
 * that a human is needed once standing authority exists; it decides *which*
 * authority is needed. A task whose text says "rm -rf" or "drop table" needs
 * a grant naming "destructive"; "production"/"deploy" needs "deploy";
 * secrets/credentials need "credential". A routine grant never covers those.
 */
export function keywordOperation(text: string): AuthorityOperation | null {
  if (/drop\s+(table|database)|truncate\s+table|rm\s+-rf|force[- ]?push|delete\s+repository|prisma\s+migrate\s+reset/i.test(text)) return "destructive";
  if (/secret|credential|auth(entication)?\s+config|api[_-]?key|password/i.test(text)) return "credential";
  if (/production|prisma\s+migrate\s+deploy|\bdeploy/i.test(text)) return "deploy";
  return null;
}

const RANK: Record<string, number> = { read: 0, write: 1, exec: 2, delegate: 2, external: 3, publish: 3, deploy: 4, credential: 5, destructive: 6, financial: 6, legal: 6 };

/** The most consequential operation the task implies (structured class vs. text). */
export function requiredTaskOperation(actionClass: string, text: string): AuthorityOperation {
  const structural = operationForActionClass(actionClass);
  const keyword = keywordOperation(text);
  if (!keyword) return structural;
  return (RANK[keyword] ?? 0) > (RANK[structural] ?? 0) ? keyword : structural;
}
