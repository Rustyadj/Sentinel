export type TrustLevel = 0 | 1 | 2 | 3 | 4;

const READ_ONLY = /^(?:get|list|search|retrieve|inspect|summarize|read)[._-]/i;
const DRAFT = /(?:draft|propose|candidate|request_approval|create_note|create_task|send_agent_message|append_conversation_message)/i;
const PRIVILEGED = /(?:deploy|production|permission|secret|financial|payment|infrastructure|restart|rollback_production|execute_shell|run_sql)/i;

export function requiredTrustLevel(operation: string, mutates: boolean): TrustLevel {
  if (PRIVILEGED.test(operation)) return 4;
  if (READ_ONLY.test(operation) && !mutates) return 0;
  if (DRAFT.test(operation)) return /email|crm|external|deploy/i.test(operation) ? 2 : 1;
  return mutates ? 3 : 0;
}

export function authorizeTrust(input: { configuredLevel: number; operation: string; mutates: boolean; approvalId?: string }) {
  const required = requiredTrustLevel(input.operation, input.mutates);
  if (required === 4 && !input.approvalId) return { allowed: false, required, reason: "Level 4 always requires explicit human approval." };
  if (input.configuredLevel < required) return { allowed: false, required, reason: `Trust level ${required} is required.` };
  return { allowed: true, required, reason: "Trust policy satisfied." };
}
