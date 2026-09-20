# Current state

- Task: production ChatGPT ↔ Sentinel MCP ↔ memory/orchestration/agents completion
- Branch: `feature/gemini-runtime`
- Release commit on `main`: `84b57cdeb902147a709c88565378e7fdd6389d3d`
- Completed: OAuth DCR/PKCE/resource binding/refresh rotation; deterministic permitted context discovery; project/workspace-scoped memory; governed memory exclusion/ranking/usage recording; real orchestration/runtime dispatch; MCP tools plus `sentinel://context` and `sentinel://capabilities`; task read/result/cancel permission revalidation; canonical external-client probe; production configuration docs.
- Targeted verification: 55 MCP/OAuth/context/routing/runtime tests passed; typecheck passed; production build passed; public discovery probe passed 16/16.
- Full suite: run once. 386 passed, 237 failed, 17 skipped because the original worktree had no `DATABASE_URL` or Redis. `origin/main` subsequently added isolated test database/Redis handling; targeted tests were rerun green after rebasing.
- Production: pushed to `main`, but `https://sentinel.srv1427612.hstgr.cloud/api/version` still reports `b720da5eefdc1457d33f711d18e988739d4ef7ba`. The existing GitHub deploy workflow has not advanced production to the release commit.
- External blocker: approve/unblock the GitHub `production` environment run for commit `84b57cd` (or repair its configured VPS secrets if the run reports that error).
- Exact next action after deployment: verify `/api/version` reports `84b57cd`, then run `node scripts/mcp-live-probe.mjs --base https://sentinel.srv1427612.hstgr.cloud`; open the printed authorization URL, sign in as the intended Sentinel owner, and approve the requested scopes. Supply `MCP_PROBE_FOREIGN_TOKEN` from a second user to make the cross-user production check mandatory.
