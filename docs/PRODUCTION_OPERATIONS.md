# Production Operations & Deployment

## Deployment Gating

All production deployments are gated behind a `Production readiness / deploy-gate` workflow check. This check must pass before the auto-deploy workflow is triggered.

### Pre-Deployment Requirements

Before deploying to production, the following must be verified:

1. **Immutable Commit SHA**
   - Deployment targets only green, tagged commits from `main`
   - Commit SHA is captured at workflow trigger time and used throughout deployment
   - No fast-forward pushes or rewrites are permitted to the deployed SHA

2. **Database Migrations**
   - All pending migrations have been reviewed and tested
   - Migration rollback plan is documented
   - Zero-downtime migration strategy (if applicable)

3. **Backup Verification**
   - Full database backup completed within the last 24 hours
   - Backup restoration tested and verified
   - Backup location and credentials secured

4. **Health & Readiness Checks**
   - `/api/health` — basic liveness check (fast fail)
   - `/api/ready` — full readiness check including:
     - Database connectivity
     - Critical service dependencies
     - Cache layer availability
     - Required feature flags enabled
   - Both endpoints must return `200 OK` within 2 minutes of container start

5. **Rollback Capability**
   - Previous deployment remains available for 30+ minutes
   - Rollback procedure is automated and tested
   - Rollback is executable by a single command: `git reset --hard <previous-sha> && docker compose up -d --build`

## Auto-Deploy Workflow

**File:** `.github/workflows/deploy.yml`

### Trigger Conditions

1. Workflow must be manually triggered via `workflow_dispatch` after all production readiness checks pass
2. Alternatively, automatic trigger on push to `main` only if:
   - Last commit is tagged with `v*` semver tag
   - The `Production readiness / deploy-gate` check is green

### Deployment Steps

```
1. Validate secrets and environment
2. Fetch immutable commit SHA from trigger context
3. Verify commit is reachable from origin/main
4. SSH to VPS
5. git fetch origin + checkout immutable SHA (not branch tip)
6. git reset --hard <immutable-sha> (strict verification)
7. docker compose up -d --build
8. Wait for /api/health (fast fail, 30s timeout)
9. Wait for /api/ready (full readiness, 2min timeout)
10. Verify deployment metrics (CPU, memory stable)
11. Log deployment event with commit SHA + timestamp
```

### Failure Handling

- If `/api/ready` fails after 2 minutes: **automatic rollback** to previous deployment
- Rollback is logged and escalated
- On rollback, don't re-attempt; manual investigation required
- All logs are retained for post-incident review

## Monitoring & Alerting

- Deployment pipeline status is logged to `~/.vps-deploy.log` on the VPS
- Failed deployments trigger system notification
- Post-deployment health is sampled every 60 seconds for 5 minutes

## SSH Key Rotation

- Deploy SSH key should be rotated every 90 days
- Use a dedicated deploy key, not personal SSH key
- Key rotation is tracked in the VPS backup/security log
