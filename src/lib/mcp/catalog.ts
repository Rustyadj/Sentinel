export interface McpToolDefinition {
  name: string; description: string; scope: string; mutates: boolean;
  inputSchema: Record<string, unknown>;
}

const objectSchema = (required: string[] = []) => ({ type: "object", additionalProperties: true, required });
export const MCP_TOOLS: McpToolDefinition[] = [
  { name: "sentinel.search_knowledge", description: "Search authorized canonical knowledge and return a retrieval trace.", scope: "knowledge:read", mutates: false, inputSchema: objectSchema(["query"]) },
  { name: "sentinel.retrieve_context", description: "Build token-bounded authorized context.", scope: "knowledge:read", mutates: false, inputSchema: objectSchema(["query"]) },
  { name: "sentinel.get_retrieval_trace", description: "Inspect recall scoring and exclusions.", scope: "knowledge:read", mutates: false, inputSchema: objectSchema(["traceId"]) },
  { name: "sentinel.list_projects", description: "List projects in the client scope.", scope: "projects:read", mutates: false, inputSchema: objectSchema() },
  { name: "sentinel.get_project", description: "Get one authorized project.", scope: "projects:read", mutates: false, inputSchema: objectSchema(["projectId"]) },
  { name: "sentinel.list_agents", description: "List scoped agent capabilities.", scope: "agents:read", mutates: false, inputSchema: objectSchema() },
  { name: "sentinel.get_agent_status", description: "Get configured agent status.", scope: "agents:read", mutates: false, inputSchema: objectSchema(["agentId"]) },
  { name: "sentinel.list_skills", description: "List active versioned skills.", scope: "skills:read", mutates: false, inputSchema: objectSchema() },
  { name: "sentinel.get_skill", description: "Get a skill and its versions.", scope: "skills:read", mutates: false, inputSchema: objectSchema(["skillId"]) },
  { name: "sentinel.list_workflows", description: "List workflows in scope.", scope: "workflows:read", mutates: false, inputSchema: objectSchema() },
  { name: "sentinel.get_workflow", description: "Get workflow and persisted health.", scope: "workflows:read", mutates: false, inputSchema: objectSchema(["workflowId"]) },
  { name: "sentinel.list_pending_approvals", description: "List pending approvals in scope.", scope: "approvals:read", mutates: false, inputSchema: objectSchema() },
  { name: "sentinel.get_run", description: "Inspect a delegated or experience run.", scope: "runs:read", mutates: false, inputSchema: objectSchema(["runId"]) },
  { name: "sentinel.search_sessions", description: "Search authorized chat sessions.", scope: "sessions:read", mutates: false, inputSchema: objectSchema(["query"]) },
  { name: "sentinel.create_memory_candidate", description: "Submit untrusted knowledge to the admission firewall.", scope: "memory:propose", mutates: true, inputSchema: objectSchema(["candidateType", "content", "sourceType", "provenance"]) },
  { name: "sentinel.create_skill_candidate", description: "Submit an evaluated procedure candidate.", scope: "skills:propose", mutates: true, inputSchema: objectSchema(["name", "steps", "sourceRunIds"]) },
  { name: "sentinel.create_note", description: "Create an internal note draft.", scope: "notes:write", mutates: true, inputSchema: objectSchema(["title", "content"]) },
  { name: "sentinel.create_task", description: "Create a scoped task.", scope: "tasks:write", mutates: true, inputSchema: objectSchema(["title"]) },
  { name: "sentinel.update_task", description: "Update an authorized task.", scope: "tasks:write", mutates: true, inputSchema: objectSchema(["taskId"]) },
  { name: "sentinel.delegate_task", description: "Create a supervised delegated run.", scope: "agents:delegate", mutates: true, inputSchema: objectSchema(["agentId", "objective"]) },
  { name: "sentinel.send_agent_message", description: "Append an audited message to an agent room.", scope: "messages:write", mutates: true, inputSchema: objectSchema(["conversationId", "content"]) },
  { name: "sentinel.start_agent_run", description: "Create a supervised delegated run.", scope: "agents:delegate", mutates: true, inputSchema: objectSchema(["agentId", "objective"]) },
  { name: "sentinel.cancel_run", description: "Request cancellation of a supervised run.", scope: "runs:cancel", mutates: true, inputSchema: objectSchema(["runId"]) },
  { name: "sentinel.request_approval", description: "Create a human approval request.", scope: "approvals:write", mutates: true, inputSchema: objectSchema(["workspaceId", "title"]) },
  { name: "sentinel.run_workflow", description: "Queue an approved workflow run.", scope: "workflows:run", mutates: true, inputSchema: objectSchema(["workflowId"]) },
  { name: "sentinel.submit_run_feedback", description: "Attach human feedback to a run.", scope: "runs:feedback", mutates: true, inputSchema: objectSchema(["runId", "feedback"]) },
  { name: "sentinel.append_conversation_message", description: "Append an authorized conversation message.", scope: "messages:write", mutates: true, inputSchema: objectSchema(["conversationId", "content"]) },
];

export const MCP_RESOURCES = [
  "sentinel://organizations/{organizationId}", "sentinel://workspaces/{workspaceId}",
  "sentinel://projects/{projectId}", "sentinel://agents/{agentId}",
  "sentinel://agents/{agentId}/status", "sentinel://conversations/{conversationId}",
  "sentinel://knowledge/{objectId}", "sentinel://skills/{skillId}",
  "sentinel://workflows/{workflowId}", "sentinel://approvals/pending",
  "sentinel://runs/{runId}", "sentinel://retrieval-traces/{traceId}",
];
