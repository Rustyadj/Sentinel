# Workforce integration contract

Baseline is `d2b7e4eb4ba41dd8440904eecc683c2893f72425`. Workforce development is in `codex/workforce-platform`. The autonomy foundation is in [PR #84](https://github.com/Rustyadj/Sentinel/pull/84). This contract records the observed interfaces and the handoffs the two branches need to agree on.

| Surface | Canonical owner and interface | Workforce dependency |
| --- | --- | --- |
| Organization and teams | Existing `Organization`, `Department`, `Workspace`, and `Team` rows | Workspace-authorized views. Department writes require the organization owner or admin. A durable agent-to-department relationship, manager identity, and lifecycle/version fields require a coordinated shared schema change. |
| Agent identity and model | Existing `Agent` record, model policy and runtime registry. Autonomy adds `loadAgentIdentity` and prompt composition. | An idempotent provisioning entry point must return an agent ID linked to an executable runtime. Changing compatible models must keep the ID. |
| Objectives and execution | `listObjectives`, `getObjective`, `controlObjective`, existing orchestration runs, objective steps and events | Current objective creation supports the business-setup template. Workforce requires assignment to arbitrary provisioned agents, persistent objective plans and a durable recurrence entry point. |
| Capability discovery | Existing MCP registrations and autonomy's `discoverForAgent` via `/api/autonomy/capabilities` | Discovery returns available and missing permissions. The registry needs a supported invocation and registration contract for first-party adapters and binding to declared target resources. |
| Standing authority | Autonomy's `authorizeOperation` and grants endpoints | The workforce can display and manage existing grants through these endpoints. Automated provisioning needs an agent-actor entry point that evaluates the already delegated scope. |
| Delegation and Lisa | Canonical orchestration and the Lisa loop | A workforce provisioning action needs a typed Lisa dispatch hook. Workforce needs explicit agent-ID routing and coordination independent of the Lisa conversation. |
| Skills and memory | Learning scope and skill version services, agent-scoped identity and memory | Reuse the skills catalog and activation endpoints. Memory access remains subject to the canonical runtime's access policy. |
| Execution and accounting | Objective events and steps, orchestration runs, attempts, recorded cost provenance | Display source-specific measures. Workspace aggregate measures already available. Per-department and per-agent metrics require stable attribution, and missing recorded costs require provenance rather than inferred estimates. |
| Resource and schedule activation | Existing agent-workspace, bot routines, and orchestration services | Core needs a scheduled activation contract for provisioned agent IDs, with authority evaluated by the worker at execution time. |

The proposed commit boundary is a workforce-side command carrying workspace ID, authenticated actor, validated plan, and stable request ID. The canonical operation should return department, agent, objective, and scheduled activation IDs plus per-capability availability. It must be safe to retry after a partial failure, preserve tenant scoping at every write, and resolve standing authority at execution. A plan can list proposed capabilities but grants none. No workforce schema, migration, runtime, identity store, or authorization policy is added by this branch.

The existing agent-record API persists a row. The baseline runtime router maps fixed agent IDs, so writing five arbitrary rows would give the operator five records without five executable agents. The workforce draft is intentionally a draft until that provisioning contract exists. Department creation and edits use existing departments with workspace and organization checks. Team creation and reassignment use the canonical Team service and workspace permissions. Existing objective controls and skill version APIs continue to own execution and publication state.

## Capability integration

- Browser execution uses the Playwright provider under `agent-workspaces` and the isolated browser deployment below. Keep browser results as data. Publishing screenshots and downloads into objective deliverables still requires the canonical artifact handoff.
- MCP registration and connection are the existing path for external services. A configuration record alone cannot attest readiness. Live credential and provider probes are separate from capability discovery.
- Hermes voice uses the existing voice configuration, LiveKit and OpenAI realtime routes, and Telnyx infrastructure. Provider adapters should advertise modality-specific support and route media through canonical workspace artifacts.
- A2UI's current v1.0 design uses client-owned catalogs and declarative components with separate action messages. Sentinel's workforce surface uses a bounded local schema based on that design. A wire-level A2UI transport requires separate catalog negotiation and message mapping. [A2UI roadmap](https://a2ui.org/roadmap/) and [message reference](https://a2ui.org/reference/messages/).

## Shared changes to coordinate

- Adopt a single additive migration for department-to-agent membership, reporting relationships, and durable workforce plan revisions after autonomy schema changes land. Reuse `Team` for project membership and `Department` for hierarchy.
- Add root navigation once both branches agree on Workforce placement. The initial page is available at `/workforce`.
- Connect the typed Lisa action to canonical provisioning, then verify five real runtime bindings, delegated authority, worker restart recovery, deliverables, and recurring reporting on isolated Postgres/Redis with configured providers.

## Workforce branch verification and deployment

- The authenticated Workforce console opens from Agents → Workforce or `/workforce`. The console uses existing roles, data, objective controls, runtime settings, skill activation and MCP catalog APIs. The Genesis editor supports natural-language plans, manual plans, the five-specialist marketing template, and import/export for reusing drafts. Natural-language planning requires `OPENROUTER_API_KEY`; `WORKFORCE_PLANNING_MODEL` optionally chooses the planning model.
- `src/lib/workforce/provisioning.ts` defines the command and receipt adapter. Connect it to the canonical service when available. Its fixtures exercise the Titan ICF draft handoff and receipt validation. The production Genesis endpoint generates drafts.
- The existing agent-workspace browser endpoint accepts a `workflow` action with a session ID and an array of `click`, `fill` and `extract` actions scoped to the current page. The existing Playwright context executes steps and stops at the first failure. A reported failure may include earlier completed actions. The caller must reconcile those actions before retrying.
- Chromium runs in the separate browser service described below. Session IDs, the last URL, cookies, local storage, and IndexedDB are recoverable after app or browser restart. Call browser create to resume; an existing session ID can also navigate or run a workflow after a restart.
- Workforce audio accepts recordings for transcription and generates MP3 speech through the existing OpenAI service credentials. It requires `OPENAI_API_KEY` and workspace runtime execution permission. Hermes and realtime voice retain their existing entry points. OpenAI Responses analyzes images, screenshots and PDFs. Set `WORKFORCE_ANALYSIS_MODEL` to choose a compatible analysis model. Live provider tests, continuous video processing and provider capability registration remain integration work.
- Workforce and Bot Studio both use the existing MCP catalog and live discovery. For authenticated connections, configure the credential bindings described below. Discovery status and the number of tools in the catalog reflect the last handshake and current credential availability. Executing remote tools from specialized agents requires a canonical invocation contract.
- Skill activation calls the canonical Learning Core endpoint. Rollback needs a canonical service correction before it can be exposed to operators. The current implementation selects the highest earlier version other than a rolled-back version, which can be a draft that has never passed activation. The restore query should select previously active versions only and verify tenant access through the existing authorization path.
- Validate against an isolated PostgreSQL and Redis. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. For the authenticated UI test, point the app and `SENTINEL_WORKFORCE_E2E_DATABASE_URL` at the same migrated local database named `sentinel_*_e2e_test`, then run `npm run test:e2e -- tests/e2e/workforce.spec.ts tests/e2e/workforce-browser.spec.ts`.

### Browser deployment

Add `docker-compose.browser.yml` to the base Compose invocation and start the `browser` and `app` services. Set `SENTINEL_BROWSER_WS_PATH` to a private URL path such as a slash followed by 32 random hexadecimal characters. The browser port stays on an internal control network. Set `SENTINEL_BROWSER_EGRESS_NETWORK` to an **internal** Docker network that the deployment egress proxy joins, and `SENTINEL_BROWSER_WORKFLOW_PROXY` to that proxy's HTTP URL. The deployment proxy needs to enforce its destination policy for HTTP and TLS tunnels. Keep the browser on the provided internal networks with no published ports.

The app writes encrypted checkpoints to the `browser_state` volume using a key derived from `AUTH_SECRET`. Keep that volume and secret across replacements. The Compose configuration uses one app process as the checkpoint writer. Close clears the checkpoint. Restoring a page makes a fresh navigation to the saved URL. Unsaved DOM changes, session storage, and in-flight actions need application-level recovery. An interrupted external action may already have taken effect, so reconcile the provider result before resubmitting it.

The release-candidate browser check runs the non-root Chromium service, a fixture proxy restricted to one test origin, and the isolated standalone app image. It checks form execution, screenshots, browser network routing, workspace isolation, and recovery after restarting both services.

### Authenticated MCP connections

Compose loads the optional app-only `MCP_CATALOG_CREDENTIAL_ENV_FILE` (defaults to `./.env.mcp-credentials`). Place the env file outside the source tree when using a custom name. Keep the bearer token in the existing process environment and configure its binding there:

```dotenv
ACME_MCP_TOKEN=replace-with-provider-token
MCP_CATALOG_CREDENTIAL_BINDINGS='{"acme":{"workspaceId":"workspace-id","endpoint":"https://api.example.com/mcp","label":"Acme MCP","env":"ACME_MCP_TOKEN"}}'
```

Choose the configured binding in Workforce or Bot Studio. Discovery checks the workspace ID and exact endpoint before accessing the token, and authenticated requests reject redirects. Existing bearer registrations continue to resolve after adding a matching binding. For the bundled MobileOps installer, set `MOBILEOPS_MCP_WORKSPACE_ID` alongside the existing deployment-owned URL and token, or add a matching workspace binding for `MOBILEOPS_MCP_TOKEN`.

The Workforce Operations view follows persisted objective events through a workspace-authorized stream. Runtime collaboration, recurrence and deliverable verification still depend on the specialized-agent provisioning and execution contracts.
