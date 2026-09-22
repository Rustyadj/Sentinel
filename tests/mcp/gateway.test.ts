/**
 * End-to-end smoke test for the external MCP gateway.
 *
 * Drives the real modules — the same registerClient / resolveAuthorizeRequest /
 * exchangeAuthorizationCode / handleMessage the routes call — over the
 * in-memory store, so the whole OAuth-to-tool-call path is exercised with no
 * database and no network. The route handlers are thin wrappers over exactly
 * these calls; what is asserted here is the protocol behaviour that would
 * otherwise only be observable against a deployed host.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  authenticateBearer,
  authorizationServerMetadata,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  issueAuthorizationCode,
  protectedResourceMetadata,
  registerClient,
  resolveAuthorizeRequest,
  type McpPrincipal,
} from "@/lib/mcp/oauth";
import { memoryStore, type McpStore } from "@/lib/mcp/store";
import { MCP_SCOPES, ALL_SCOPES, formatScopeString } from "@/lib/mcp/scopes";
import { randomToken, s256Challenge } from "@/lib/mcp/tokens";
import { handleMessage, PROTOCOL_VERSION, type JsonRpcResponse } from "@/lib/mcp/server";
import type { McpDataSource, MemoryRecord, TaskRecord, ToolContext } from "@/lib/mcp/tools";

const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

beforeAll(() => {
  process.env.AUTH_SECRET ??= "mcp-gateway-test-secret";
  process.env.MCP_GATEWAY_ISSUER = "https://sentinel.test";
});

/** Fixture data source — the tools are real, only the rows are fake. */
function fixtureData(): McpDataSource {
  const tasks: TaskRecord[] = [
    { id: "t1", title: "Ship MCP gateway", description: "external connector", status: "in_progress", priority: "high", agentId: null, createdAt: new Date() },
  ];
  const memories: MemoryRecord[] = [
    { id: "m1", type: "note", content: "Sentinel exposes tools over MCP", tags: ["mcp"], importanceScore: 0.9, createdAt: new Date() },
  ];
  return {
    async getWorkspaceOverview() {
      return { workspace: { id: "ws-1", name: "Sentinel", slug: "sentinel", description: "Test workspace", kind: "general" }, counts: { projects: 1, tasks: tasks.length, memories: memories.length } };
    },
    async listCatalogRecords({ query, kind, limit }) {
      const needle = query?.toLowerCase();
      const records = [
        ...memories.map((memory) => ({ kind: "memory" as const, id: memory.id, title: memory.content.slice(0, 100), text: memory.content, path: `/memory?id=${memory.id}`, metadata: { tags: memory.tags } })),
        ...tasks.map((task) => ({ kind: "task" as const, id: task.id, title: task.title, text: task.description ?? task.title, path: `/kanban?task=${task.id}`, metadata: { status: task.status } })),
        { kind: "document" as const, id: "d1", title: "Gateway runbook", text: "How to operate the Sentinel MCP gateway", path: "/files?document=d1", metadata: { type: "markdown" } },
      ];
      return records.filter((record) => (!kind || record.kind === kind) && (!needle || `${record.title} ${record.text}`.toLowerCase().includes(needle))).slice(0, limit);
    },
    async getCatalogRecord({ kind, id }) {
      return (await this.listCatalogRecords({ workspaceId: "ws-1", userId: "user-1", limit: 100 })).find((record) => record.kind === kind && record.id === id) ?? null;
    },
    async listAgents() {
      return [{ id: "a1", name: "Lisa", role: "CMO", description: "", status: "online", model: "claude-sonnet-5" }];
    },
    async searchMemories({ query }) {
      return memories.filter((memory) => memory.content.toLowerCase().includes(query.toLowerCase()));
    },
    async listTasks() {
      return tasks;
    },
    async createTask({ title, description, priority }) {
      const task = { id: `t${tasks.length + 1}`, title, description: description ?? null, status: "backlog", priority: priority ?? "medium", agentId: null, createdAt: new Date() };
      tasks.push(task);
      return task;
    },
    async getTask({ id }) {
      return tasks.find((task) => task.id === id) ?? null;
    },
    async getMemory({ id }) {
      return memories.find((memory) => memory.id === id) ?? null;
    },
  };
}

function context(principal: McpPrincipal): ToolContext {
  return { principal, data: fixtureData(), baseUrl: "https://sentinel.test" };
}

async function rpc(principal: McpPrincipal, method: string, params?: Record<string, unknown>) {
  const response = (await handleMessage({ jsonrpc: "2.0", id: 1, method, params }, context(principal))) as JsonRpcResponse;
  return response;
}

/**
 * The full connector handshake, exactly as ChatGPT performs it:
 * register -> authorize (+consent) -> token. Returns the issued tokens.
 */
async function connect(store: McpStore, approvedScopes: string[] = ALL_SCOPES) {
  const registration = await registerClient(store, {
    client_name: "ChatGPT",
    redirect_uris: [REDIRECT_URI],
    scope: formatScopeString(ALL_SCOPES),
  });

  const verifier = randomToken(32);
  const resolved = await resolveAuthorizeRequest(store, {
    clientId: registration.client_id,
    redirectUri: REDIRECT_URI,
    scope: formatScopeString(ALL_SCOPES),
    codeChallenge: s256Challenge(verifier),
    codeChallengeMethod: "S256",
    state: "state-123",
  });

  const { code, redirectTo } = await issueAuthorizationCode(store, resolved, {
    userId: "user-1",
    workspaceId: "ws-1",
    approvedScopes: approvedScopes as never,
  });

  const tokens = await exchangeAuthorizationCode(store, {
    clientId: registration.client_id,
    clientSecret: null,
    code,
    redirectUri: REDIRECT_URI,
    codeVerifier: verifier,
  });

  return { registration, verifier, code, redirectTo, tokens, resolved };
}

describe("MCP gateway — discovery", () => {
  it("advertises PKCE-only OAuth 2.1 with the endpoints a client must find", () => {
    const metadata = authorizationServerMetadata();
    expect(metadata.issuer).toBe("https://sentinel.test");
    expect(metadata.authorization_endpoint).toBe("https://sentinel.test/mcp/authorize");
    expect(metadata.token_endpoint).toBe("https://sentinel.test/api/mcp/oauth/token");
    expect(metadata.registration_endpoint).toBe("https://sentinel.test/api/mcp/oauth/register");
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(protectedResourceMetadata().resource).toBe("https://sentinel.test/api/mcp");
  });
});

describe("MCP gateway — authentication and scopes", () => {
  it("runs the full register -> authorize -> token -> tools/call handshake", async () => {
    const store = memoryStore();
    const { tokens, redirectTo } = await connect(store);

    // The code comes back on the registered redirect, with state preserved.
    expect(redirectTo.startsWith(`${REDIRECT_URI}?`)).toBe(true);
    expect(new URL(redirectTo).searchParams.get("state")).toBe("state-123");
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.refresh_token).toBeTruthy();

    const principal = await authenticateBearer(store, `Bearer ${tokens.access_token}`);
    expect(principal).not.toBeNull();
    expect(principal!.userId).toBe("user-1");
    expect(principal!.workspaceId).toBe("ws-1");

    const initialize = await rpc(principal!, "initialize");
    expect((initialize.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSION);

    const list = await rpc(principal!, "tools/list");
    const names = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    // ChatGPT's deep-research contract requires these two exact names.
    expect(names).toContain("search");
    expect(names).toContain("fetch");
    expect(names).toContain("sentinel_workspace_overview");
    expect(names).toContain("sentinel_list_content");
    expect(names).toContain("sentinel_create_task");

    const tools = (list.result as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] }).tools;
    expect(tools.find((tool) => tool.name === "search")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "sentinel_create_task")?.annotations?.readOnlyHint).toBe(false);

    const call = await rpc(principal!, "tools/call", { name: "sentinel_list_tasks", arguments: {} });
    const result = call.result as { isError: boolean; structuredContent: { tasks: { title: string }[] } };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.tasks[0].title).toBe("Ship MCP gateway");
  });

  it("rejects a missing, malformed or unsigned bearer token", async () => {
    const store = memoryStore();
    expect(await authenticateBearer(store, null)).toBeNull();
    expect(await authenticateBearer(store, "Bearer not-a-token")).toBeNull();
    const { tokens } = await connect(store);
    // Tamper with the signature segment.
    const [header, body] = tokens.access_token.split(".");
    expect(await authenticateBearer(store, `Bearer ${header}.${body}.deadbeef`)).toBeNull();
  });

  it("hides and refuses tools outside the consented scopes", async () => {
    const store = memoryStore();
    // Consent to read-only: tasks.write is never approved.
    const { tokens } = await connect(store, [MCP_SCOPES.tasksRead, MCP_SCOPES.searchRead]);
    const principal = (await authenticateBearer(store, `Bearer ${tokens.access_token}`))!;

    const list = await rpc(principal, "tools/list");
    const names = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).toContain("sentinel_list_tasks");
    expect(names).not.toContain("sentinel_create_task");
    expect(names).not.toContain("sentinel_list_agents");

    // Calling the hidden tool by name anyway is refused — as a tool error the
    // model can read, not a transport error the client would swallow.
    const call = await rpc(principal, "tools/call", { name: "sentinel_create_task", arguments: { title: "nope" } });
    const result = call.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(MCP_SCOPES.tasksWrite);
  });

  it("stops accepting tokens the moment the grant is revoked", async () => {
    const store = memoryStore();
    const { tokens } = await connect(store);
    const principal = (await authenticateBearer(store, `Bearer ${tokens.access_token}`))!;

    await store.revokeGrant(principal.grantId);
    // Same still-unexpired token, now dead.
    expect(await authenticateBearer(store, `Bearer ${tokens.access_token}`)).toBeNull();
  });
});

describe("MCP gateway — OAuth 2.1 hardening", () => {
  it("refuses an authorization request without PKCE S256", async () => {
    const store = memoryStore();
    const registration = await registerClient(store, { client_name: "c", redirect_uris: [REDIRECT_URI] });
    await expect(
      resolveAuthorizeRequest(store, {
        clientId: registration.client_id,
        redirectUri: REDIRECT_URI,
        scope: null,
        codeChallenge: "whatever",
        codeChallengeMethod: "plain",
        state: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses an OAuth resource that is not this MCP endpoint", async () => {
    const store = memoryStore();
    const registration = await registerClient(store, { client_name: "c", redirect_uris: [REDIRECT_URI] });
    await expect(resolveAuthorizeRequest(store, {
      clientId: registration.client_id,
      redirectUri: REDIRECT_URI,
      scope: null,
      codeChallenge: s256Challenge("v"),
      codeChallengeMethod: "S256",
      state: null,
      resource: "https://other.example/mcp",
    })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses a redirect_uri the client never registered", async () => {
    const store = memoryStore();
    const registration = await registerClient(store, { client_name: "c", redirect_uris: [REDIRECT_URI] });
    await expect(
      resolveAuthorizeRequest(store, {
        clientId: registration.client_id,
        redirectUri: "https://attacker.example/callback",
        scope: null,
        codeChallenge: s256Challenge("v"),
        codeChallengeMethod: "S256",
        state: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses to register a plaintext non-loopback redirect_uri", async () => {
    const store = memoryStore();
    await expect(
      registerClient(store, { client_name: "c", redirect_uris: ["http://attacker.example/cb"] }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    // Loopback http stays allowed for local MCP clients.
    await expect(
      registerClient(store, { client_name: "c", redirect_uris: ["http://127.0.0.1:3333/cb"] }),
    ).resolves.toMatchObject({ client_name: "c" });
  });

  it("rejects a mismatched PKCE verifier", async () => {
    const store = memoryStore();
    const registration = await registerClient(store, { client_name: "c", redirect_uris: [REDIRECT_URI] });
    const resolved = await resolveAuthorizeRequest(store, {
      clientId: registration.client_id,
      redirectUri: REDIRECT_URI,
      scope: null,
      codeChallenge: s256Challenge(randomToken(32)),
      codeChallengeMethod: "S256",
      state: null,
    });
    const { code } = await issueAuthorizationCode(store, resolved, {
      userId: "user-1",
      workspaceId: "ws-1",
      approvedScopes: resolved.scopes,
    });
    await expect(
      exchangeAuthorizationCode(store, {
        clientId: registration.client_id,
        clientSecret: null,
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: "the-wrong-verifier",
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("burns an authorization code after one use", async () => {
    const store = memoryStore();
    const { registration, code, verifier } = await connect(store);
    // The first exchange already happened inside connect().
    await expect(
      exchangeAuthorizationCode(store, {
        clientId: registration.client_id,
        clientSecret: null,
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rotates the refresh token and invalidates the old one", async () => {
    const store = memoryStore();
    const { registration, tokens } = await connect(store);

    const refreshed = await exchangeRefreshToken(store, {
      clientId: registration.client_id,
      clientSecret: null,
      refreshToken: tokens.refresh_token,
    });
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

    await expect(
      exchangeRefreshToken(store, {
        clientId: registration.client_id,
        clientSecret: null,
        refreshToken: tokens.refresh_token,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses a code redeemed by a different client", async () => {
    const store = memoryStore();
    const victim = await registerClient(store, { client_name: "victim", redirect_uris: [REDIRECT_URI] });
    const attacker = await registerClient(store, { client_name: "attacker", redirect_uris: [REDIRECT_URI] });
    const verifier = randomToken(32);
    const resolved = await resolveAuthorizeRequest(store, {
      clientId: victim.client_id,
      redirectUri: REDIRECT_URI,
      scope: null,
      codeChallenge: s256Challenge(verifier),
      codeChallengeMethod: "S256",
      state: null,
    });
    const { code } = await issueAuthorizationCode(store, resolved, {
      userId: "user-1",
      workspaceId: "ws-1",
      approvedScopes: resolved.scopes,
    });
    await expect(
      exchangeAuthorizationCode(store, {
        clientId: attacker.client_id,
        clientSecret: null,
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("cannot consent to a scope the client was never allowed", async () => {
    const store = memoryStore();
    const registration = await registerClient(store, {
      client_name: "read-only client",
      redirect_uris: [REDIRECT_URI],
      scope: MCP_SCOPES.tasksRead,
    });
    const resolved = await resolveAuthorizeRequest(store, {
      clientId: registration.client_id,
      redirectUri: REDIRECT_URI,
      scope: formatScopeString(ALL_SCOPES),
      codeChallenge: s256Challenge("v"),
      codeChallengeMethod: "S256",
      state: null,
    });
    // Narrowed at resolve time, and again if a tampered form posts more back.
    expect(resolved.scopes).toEqual([MCP_SCOPES.tasksRead]);
    await expect(
      issueAuthorizationCode(store, resolved, {
        userId: "user-1",
        workspaceId: "ws-1",
        approvedScopes: [MCP_SCOPES.tasksWrite] as never,
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  it("refuses to mint a grant without a workspace binding", async () => {
    const store = memoryStore();
    const registration = await registerClient(store, { client_name: "c", redirect_uris: [REDIRECT_URI] });
    const resolved = await resolveAuthorizeRequest(store, {
      clientId: registration.client_id,
      redirectUri: REDIRECT_URI,
      scope: null,
      codeChallenge: s256Challenge("v"),
      codeChallengeMethod: "S256",
      state: null,
    });
    await expect(issueAuthorizationCode(store, resolved, {
      userId: "user-1",
      workspaceId: null,
      approvedScopes: resolved.scopes,
    })).rejects.toMatchObject({ code: "access_denied" });
  });
});

describe("MCP gateway — JSON-RPC behaviour", () => {
  it("answers unknown methods with methodNotFound and notifications with nothing", async () => {
    const store = memoryStore();
    const { tokens } = await connect(store);
    const principal = (await authenticateBearer(store, `Bearer ${tokens.access_token}`))!;

    const unknown = await rpc(principal, "resources/list");
    expect(unknown.error?.code).toBe(-32601);

    const notification = await handleMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      context(principal),
    );
    expect(notification).toBeNull();
  });

  it("reports a failing tool as a result with isError, not a transport error", async () => {
    const store = memoryStore();
    const { tokens } = await connect(store);
    const principal = (await authenticateBearer(store, `Bearer ${tokens.access_token}`))!;

    const call = await rpc(principal, "tools/call", { name: "fetch", arguments: { id: "memory:does-not-exist" } });
    expect(call.error).toBeUndefined();
    expect((call.result as { isError: boolean }).isError).toBe(true);
  });

  it("round-trips search -> fetch, the contract ChatGPT deep research relies on", async () => {
    const store = memoryStore();
    const { tokens } = await connect(store);
    const principal = (await authenticateBearer(store, `Bearer ${tokens.access_token}`))!;

    const search = await rpc(principal, "tools/call", { name: "search", arguments: { query: "MCP" } });
    const results = (search.result as { structuredContent: { results: { id: string; title: string; url: string }[] } })
      .structuredContent.results;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("url");

    const fetched = await rpc(principal, "tools/call", { name: "fetch", arguments: { id: results[0].id } });
    const document = (fetched.result as { structuredContent: { text: string } }).structuredContent;
    expect(document.text).toContain("MCP");
  });

  it("handles a JSON-RPC batch, dropping notifications from the response", async () => {
    const store = memoryStore();
    const { tokens } = await connect(store);
    const principal = (await authenticateBearer(store, `Bearer ${tokens.access_token}`))!;

    const responses = (await handleMessage(
      [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ],
      context(principal),
    )) as JsonRpcResponse[];

    expect(responses).toHaveLength(2);
    expect(responses.map((response) => response.id)).toEqual([1, 2]);
  });
});
