// Sentinel memory benchmark — fixture world and cases.
//
// The world is small enough to reason about by hand and large enough that
// top-N-by-value retrieval cannot pass by accident: each project holds more
// memories than a single prompt budget admits, so a case only scores if
// retrieval actually discriminates on the query rather than returning
// whatever happens to rank highest globally.
//
// Ids are readable on purpose. A failing case should name the memory.

import type { BenchCase, BenchWorld, BenchMemory } from "./types";

export const USER_ALICE = "bench-user-alice";
export const USER_BOB = "bench-user-bob";
export const WS_PRIMARY = "bench-ws-primary";
export const WS_SECONDARY = "bench-ws-secondary";
export const PROJ_SENTINEL = "bench-proj-sentinel";
export const PROJ_MOBILEOPS = "bench-proj-mobileops";
export const PROJ_BOB = "bench-proj-bob";

/** Fills the fields every fixture memory shares, so each row below states only
 *  what makes it interesting. */
type BenchMemoryInput = Omit<BenchMemory, "type" | "source"> &
  Partial<Pick<BenchMemory, "type" | "source">>;

const m = (memory: BenchMemoryInput): BenchMemory => ({
  confidence: 0.9,
  importanceScore: 0.5,
  valueScore: 0.5,
  tags: [],
  ...memory,
  type: memory.type ?? "fact",
  source: memory.source ?? "benchmark",
});

export const MEMORIES: BenchMemory[] = [
  // --- Project: Sentinel — durable project facts -------------------------
  m({ id: "mem-sentinel-db", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 40,
      content: "Sentinel's primary datastore is PostgreSQL 16 with the pgvector extension enabled.", tags: ["database", "postgres"] }),
  m({ id: "mem-sentinel-queue", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 38,
      content: "Background jobs in Sentinel run on BullMQ backed by Redis.", tags: ["queue", "bullmq"] }),
  m({ id: "mem-sentinel-port", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 35,
      content: "The Sentinel application container listens on port 3000 behind Traefik.", tags: ["deploy", "port"] }),
  m({ id: "mem-sentinel-auth", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 30,
      content: "Sentinel authenticates external MCP clients with OAuth 2.1 authorization code plus PKCE S256.", tags: ["auth", "oauth", "mcp"] }),
  m({ id: "mem-sentinel-orm", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 28,
      content: "Prisma is the ORM; migrations live in prisma/migrations.", tags: ["prisma", "orm"] }),
  m({ id: "mem-sentinel-testdb", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 5,
      content: "The Vitest suite runs against a throwaway PostgreSQL on port 55439, never the live database.", tags: ["testing", "vitest"] }),

  // Semantic-similarity probe: phrased with none of the query's words.
  m({ id: "mem-sentinel-ratelimit", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 20,
      content: "Inbound API traffic is throttled to 100 requests per minute per client before requests reach the handler.", tags: ["throttling"] }),

  // Lexical/exact probe: a distinctive literal token.
  m({ id: "mem-sentinel-errcode", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 18,
      content: "Error code SNTL-4471 means the orchestration worker lost its Redis connection mid-run.", tags: ["error", "SNTL-4471"] }),

  // --- Corrections / supersession / staleness ----------------------------
  m({ id: "mem-sentinel-port-old", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 90,
      content: "The Sentinel application container listens on port 8080.", tags: ["deploy", "port"],
      state: "active", supersededById: "mem-sentinel-port", validTo: 35, valueScore: 0.2 }),
  m({ id: "mem-sentinel-model-old", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 120,
      content: "Sentinel's default chat model is claude-3-opus.", tags: ["model"], valueScore: 0.15 }),
  m({ id: "mem-sentinel-model-new", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 3,
      content: "Correction: Sentinel's default chat model is claude-sonnet-4-6, not claude-3-opus.", tags: ["model", "correction"],
      confidence: 0.98, importanceScore: 0.8, valueScore: 0.85 }),

  // Contradiction pair, neither resolved — retrieval should surface both.
  m({ id: "mem-sentinel-cache-a", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 12,
      content: "The retrieval cache TTL is 60 seconds.", tags: ["cache"] }),
  m({ id: "mem-sentinel-cache-b", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 10,
      content: "The retrieval cache TTL is 300 seconds.", tags: ["cache"] }),

  // Duplicates — same fact, two rows.
  m({ id: "mem-sentinel-dup-a", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 22,
      content: "Sentinel deploys via docker compose on the Hostinger VPS.", tags: ["deploy"] }),
  m({ id: "mem-sentinel-dup-b", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 21,
      content: "Sentinel is deployed using docker compose on the Hostinger VPS.", tags: ["deploy"] }),

  // Ambiguous: "the gateway" could be MCP or payment.
  m({ id: "mem-sentinel-gw-mcp", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 15,
      content: "The MCP gateway exposes Sentinel tools to external clients at /api/mcp.", tags: ["gateway", "mcp"] }),
  m({ id: "mem-sentinel-gw-pay", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 14,
      content: "The payment gateway integration is Stripe, used only for billing exports.", tags: ["gateway", "stripe"] }),

  // False-memory distractor: plausible, explicitly never true.
  m({ id: "mem-sentinel-false", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 25,
      content: "Sentinel stores embeddings in a dedicated Pinecone index.", tags: ["false", "embeddings"],
      state: "quarantined", confidence: 0.2, valueScore: 0.05 }),

  // --- Episodic / temporal ------------------------------------------------
  m({ id: "mem-ep-1", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 9, type: "episodic",
      content: "On the first day of the MCP rollout the gateway returned 401 on every discovery request.", tags: ["incident", "mcp"] }),
  m({ id: "mem-ep-2", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 8, type: "episodic",
      content: "Next, the session gate was found to be swallowing MCP discovery routes.", tags: ["incident", "mcp"] }),
  m({ id: "mem-ep-3", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 7, type: "episodic",
      content: "Finally the MCP gateway passed all 42 live production probes.", tags: ["incident", "mcp"] }),

  // --- Entity relationships ----------------------------------------------
  m({ id: "mem-ent-lisa", owner: USER_ALICE, scope: "user", projectId: null, ageDays: 60,
      content: "Lisa is the Hermes agent owned by Andrea, and acts as CMO for AvraxeAi.", tags: ["entity", "lisa"] }),
  m({ id: "mem-ent-hughes", owner: USER_ALICE, scope: "user", projectId: null, ageDays: 59,
      content: "Hughes is the agent owned by Cody, who is Rusty's brother.", tags: ["entity", "hughes"] }),
  m({ id: "mem-ent-freida", owner: USER_ALICE, scope: "user", projectId: null, ageDays: 58,
      content: "Freida is the agent owned by Sheryl, who is Rusty's mother.", tags: ["entity", "freida"] }),

  // --- Preferences (user scope) ------------------------------------------
  m({ id: "mem-pref-concise", owner: USER_ALICE, scope: "user", projectId: null, ageDays: 45, type: "preference",
      content: "Rusty prefers concise answers with no filler; quality over quantity.", tags: ["preference"], importanceScore: 0.9, valueScore: 0.9 }),
  m({ id: "mem-pref-glass", owner: USER_ALICE, scope: "user", projectId: null, ageDays: 44, type: "preference",
      content: "No glass morphism in OpenClaw UI; match the Open WebUI dark solid style.", tags: ["preference", "design"] }),
  m({ id: "mem-pref-commit", owner: USER_ALICE, scope: "user", projectId: null, ageDays: 43, type: "preference",
      content: "Never push to a remote without explicit approval.", tags: ["preference", "git"], importanceScore: 0.95 }),

  // --- Procedural (seeded now so Phase 5 has a before/after) --------------
  m({ id: "mem-proc-deploy", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 16, type: "procedure",
      content: "To deploy Sentinel: run the test suite, build the image, then docker compose up -d app, then verify /api/health.", tags: ["procedure", "deploy"] }),
  m({ id: "mem-proc-migrate", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 15, type: "procedure",
      content: "To add a migration: edit schema.prisma, run prisma migrate dev, review the generated SQL, then commit both.", tags: ["procedure", "prisma"] }),
  m({ id: "mem-proc-probe", owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL, ageDays: 6, type: "procedure",
      content: "To verify the MCP gateway after a change, run the discovery-only probe against the production origin.", tags: ["procedure", "mcp"] }),

  // --- Long-running accumulation: low-value noise in the same scope -------
  ...Array.from({ length: 25 }, (_, i) =>
    m({ id: `mem-noise-${i + 1}`, owner: USER_ALICE, scope: "project", projectId: PROJ_SENTINEL,
        ageDays: 2 + i, valueScore: 0.55, importanceScore: 0.5,
        content: `Routine build ${i + 1} completed without notable findings.`, tags: ["noise"] })),

  // --- Project: MobileOps — isolation counterpart -------------------------
  m({ id: "mem-mobileops-db", owner: USER_ALICE, scope: "project", projectId: PROJ_MOBILEOPS, ageDays: 20,
      content: "MobileOps stores its field data in MongoDB.", tags: ["database", "mongo"] }),
  m({ id: "mem-mobileops-domain", owner: USER_ALICE, scope: "project", projectId: PROJ_MOBILEOPS, ageDays: 19,
      content: "MobileOps is live at icfops.srv1427612.hstgr.cloud and serves ICF concrete contractors.", tags: ["deploy"] }),
  m({ id: "mem-mobileops-secret", owner: USER_ALICE, scope: "project", projectId: PROJ_MOBILEOPS, ageDays: 18,
      content: "MobileOps uses a separate Expo build pipeline from the Sentinel web app.", tags: ["build"] }),

  // --- Workspace scope ----------------------------------------------------
  m({ id: "mem-ws-policy", owner: USER_ALICE, scope: "workspace", projectId: null, ageDays: 33,
      content: "Every AvraxeAi workspace project must keep production and staging credentials in separate vaults.", tags: ["policy"] }),
  m({ id: "mem-ws-standup", owner: USER_ALICE, scope: "workspace", projectId: null, ageDays: 32,
      content: "The AvraxeAi workspace runs an async written standup instead of a daily call.", tags: ["process"] }),

  // --- Global -------------------------------------------------------------
  m({ id: "mem-global-tz", owner: USER_ALICE, scope: "global", projectId: null, ageDays: 70,
      content: "All Sentinel timestamps are stored in UTC.", tags: ["convention"] }),

  // --- Other user (isolation) --------------------------------------------
  m({ id: "mem-bob-secret", owner: USER_BOB, scope: "project", projectId: PROJ_BOB, ageDays: 10,
      content: "Bob's project uses a private API key rotation schedule of 14 days.", tags: ["private"] }),
  m({ id: "mem-bob-pref", owner: USER_BOB, scope: "user", projectId: null, ageDays: 11,
      content: "Bob prefers verbose explanations with worked examples.", tags: ["preference"] }),
];

export const WORLD: BenchWorld = {
  users: [
    { id: USER_ALICE, email: "alice@bench.sentinel.test", name: "Alice Bench" },
    { id: USER_BOB, email: "bob@bench.sentinel.test", name: "Bob Bench" },
  ],
  workspaces: [
    { id: WS_PRIMARY, slug: "bench-primary", name: "Bench Primary", ownerId: USER_ALICE },
    { id: WS_SECONDARY, slug: "bench-secondary", name: "Bench Secondary", ownerId: USER_BOB },
  ],
  projects: [
    { id: PROJ_SENTINEL, name: "Bench Sentinel", userId: USER_ALICE, workspaceId: WS_PRIMARY },
    { id: PROJ_MOBILEOPS, name: "Bench MobileOps", userId: USER_ALICE, workspaceId: WS_PRIMARY },
    { id: PROJ_BOB, name: "Bench Bob", userId: USER_BOB, workspaceId: WS_SECONDARY },
  ],
  memories: MEMORIES,
};

const alice = (projectId?: string) => ({
  userId: USER_ALICE,
  ...(projectId ? { projectId } : {}),
  workspaceId: WS_PRIMARY,
  scopePolicy: "user-context" as const,
});

export const CASES: BenchCase[] = [
  // 1. factual recall
  { id: "factual-db", categories: ["factual_recall"], query: "What database does Sentinel use?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-db"] },
  { id: "factual-queue", categories: ["factual_recall"], query: "How does Sentinel run background jobs?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-queue"] },
  { id: "factual-auth", categories: ["factual_recall", "lexical_retrieval"], query: "How are MCP clients authenticated with OAuth and PKCE?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-auth"] },

  // 2. cross-session recall — a fact stored long ago, asked in a fresh context
  { id: "cross-session-orm", categories: ["cross_session_recall", "factual_recall"], query: "Which ORM does Sentinel use and where do migrations live?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-orm"],
    notes: "No room/session id is supplied: the fact must survive outside the session that created it." },

  // 3. project-specific recall
  { id: "project-mobileops-db", categories: ["project_recall"], query: "What database does this project use?",
    ctx: alice(PROJ_MOBILEOPS), relevant: ["mem-mobileops-db"], forbidden: ["mem-sentinel-db"], forbiddenReason: "leakage" },

  // 4. workspace recall
  { id: "workspace-policy", categories: ["workspace_recall"], query: "What is the workspace credential policy?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-ws-policy"],
    notes: "Workspace-scope memory requested from inside a project in that workspace." },
  { id: "workspace-standup", categories: ["workspace_recall"], query: "How does this workspace run standups?",
    ctx: { userId: USER_ALICE, workspaceId: WS_PRIMARY, scopePolicy: "user-context" }, relevant: ["mem-ws-standup"] },

  // 5. user preference recall
  { id: "pref-style", categories: ["preference_recall"], query: "How does Rusty like answers written?",
    ctx: alice(), relevant: ["mem-pref-concise"] },
  { id: "pref-git", categories: ["preference_recall"], query: "Am I allowed to push to the remote?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-pref-commit"] },

  // 6. episodic recall
  { id: "episodic-incident", categories: ["episodic_recall"], query: "What happened during the MCP rollout?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-ep-1", "mem-ep-2", "mem-ep-3"] },

  // 7. temporal ordering
  { id: "temporal-incident", categories: ["temporal_ordering", "episodic_recall"], query: "Walk me through the MCP rollout in order.",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-ep-1", "mem-ep-2", "mem-ep-3"],
    expectedOrder: ["mem-ep-1", "mem-ep-2", "mem-ep-3"] },

  // 8. entity relationships
  { id: "entity-owners", categories: ["entity_relationships"], query: "Who owns the Hermes agents and how are they related to Rusty?",
    ctx: alice(), relevant: ["mem-ent-lisa", "mem-ent-hughes", "mem-ent-freida"] },

  // 9. semantic similarity — no shared vocabulary with the target
  { id: "semantic-ratelimit", categories: ["semantic_similarity"], query: "Is there a cap on how often a client may call the API?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-ratelimit"],
    notes: "Target says 'throttled to 100 requests per minute'; query shares no content words. Lexical overlap scores ~0." },

  // 10. exact / lexical retrieval
  { id: "lexical-errcode", categories: ["lexical_retrieval"], query: "What does SNTL-4471 mean?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-errcode"] },

  // 11. corrections
  { id: "correction-model", categories: ["corrections"], query: "What is Sentinel's default chat model?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-model-new"], forbidden: ["mem-sentinel-model-old"], forbiddenReason: "superseded" },

  // 12. contradictions
  { id: "contradiction-cache", categories: ["contradictions"], query: "What is the retrieval cache TTL?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-cache-a", "mem-sentinel-cache-b"],
    notes: "Both must surface. Silently returning one is a worse failure than returning both and flagging the conflict." },

  // 13. supersession
  { id: "supersession-port", categories: ["supersession"], query: "Which port does the Sentinel container listen on?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-port"], forbidden: ["mem-sentinel-port-old"], forbiddenReason: "superseded" },

  // 14. stale information
  { id: "stale-port", categories: ["stale_information"], query: "Give me the current deployment configuration.",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-port"], forbidden: ["mem-sentinel-port-old"], forbiddenReason: "stale" },

  // 15. irrelevant-memory rejection
  { id: "irrelevant-noise", categories: ["irrelevant_rejection"], query: "What error code indicates a lost Redis connection?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-errcode"],
    forbidden: ["mem-noise-1", "mem-noise-2", "mem-noise-3"], forbiddenReason: "irrelevant" },

  // 16. false-memory rejection
  { id: "false-pinecone", categories: ["false_memory_rejection"], query: "Where does Sentinel store its embeddings?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-db"], forbidden: ["mem-sentinel-false"], forbiddenReason: "false",
    notes: "The Pinecone memory is quarantined and must never reach a prompt." },

  // 17. project isolation
  { id: "isolation-project", categories: ["project_isolation"], query: "What is the deployment domain for this project?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-port"], forbidden: ["mem-mobileops-domain", "mem-mobileops-db"], forbiddenReason: "leakage" },

  // 18. workspace isolation
  { id: "isolation-workspace", categories: ["workspace_isolation"], query: "What is the API key rotation schedule?",
    ctx: alice(PROJ_SENTINEL), relevant: [], forbidden: ["mem-bob-secret"], forbiddenReason: "leakage" },

  // 19. user isolation
  { id: "isolation-user", categories: ["user_isolation"], query: "How does the user prefer explanations?",
    ctx: alice(), relevant: ["mem-pref-concise"], forbidden: ["mem-bob-pref"], forbiddenReason: "leakage" },

  // 20. cross-project leakage
  { id: "leakage-cross-project", categories: ["cross_project_leakage"], query: "Tell me about the Expo build pipeline.",
    ctx: alice(PROJ_SENTINEL), relevant: [], forbidden: ["mem-mobileops-secret"], forbiddenReason: "leakage",
    notes: "Asked from the wrong project. The correct behaviour is to retrieve nothing rather than reach across." },

  // 21. procedural memory
  { id: "procedural-deploy", categories: ["procedural_memory"], query: "What are the steps to deploy Sentinel?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-proc-deploy"] },
  { id: "procedural-migrate", categories: ["procedural_memory"], query: "How do I add a database migration?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-proc-migrate"] },
  { id: "procedural-probe", categories: ["procedural_memory"], query: "How do I check the MCP gateway still works after a change?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-proc-probe"] },

  // 22. long-running accumulation
  { id: "accumulation-signal", categories: ["long_running_accumulation"], query: "Which test database does the suite use?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-testdb"],
    notes: "25 recent low-signal 'routine build' memories compete for the same budget." },

  // 23. duplicate memories
  { id: "duplicate-deploy", categories: ["duplicate_memories"], query: "How is Sentinel deployed?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-dup-a", "mem-sentinel-dup-b"],
    notes: "Both are correct. The cost of duplication is budget, not accuracy — measured via contextTokens." },

  // 24. ambiguous memories
  { id: "ambiguous-gateway", categories: ["ambiguous_memories"], query: "Tell me about the gateway.",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-gw-mcp", "mem-sentinel-gw-pay"],
    notes: "Genuinely ambiguous: both senses should surface rather than one being guessed." },

  // 25. conflicting memories
  { id: "conflicting-model", categories: ["conflicting_memories", "corrections"], query: "Which model should I assume Sentinel runs on?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-sentinel-model-new"], forbidden: ["mem-sentinel-model-old"], forbiddenReason: "superseded" },

  // Global scope reachability
  { id: "global-timezone", categories: ["factual_recall"], query: "What timezone are timestamps stored in?",
    ctx: alice(PROJ_SENTINEL), relevant: ["mem-global-tz"] },
];
