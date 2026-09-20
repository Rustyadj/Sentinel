# Duplicate user identity — status and follow-up

## What happened

Two `users` rows exist for the same person:

| | capital-R | lowercase |
|---|---|---|
| id | `cmqyvtod10000jv013gcp11n5` | `cmse53o8h01app4014ql3kqh8` |
| email | `Rustyadj@gmail.com` | `rustyadj@gmail.com` |
| created | 2026-06-29 | 2026-08-04 |
| password | set (credentials signup) | none (social login) |

Every email lookup was case-sensitive against a case-sensitive unique index
(`users_email_key`, a plain btree on `email`; `citext` is not installed). The
account was registered with a capital R; when the user later signed in with a
social provider, the provider returned the canonical lowercase address, the
NextAuth `jwt` callback's `upsert` found no match, and it created a second
identity.

## Application behavior after the MCP audit (2026-09-20)

`src/lib/auth/email.ts` normalizes to trimmed lowercase. `src/lib/auth/identity.ts`
also queries case-insensitively and deliberately sees every matching row:

- `src/auth.ts` — credentials select the sole password-bearing identity;
  social login fails closed if more than one normalized identity exists
- `src/lib/current-user.ts` — the session id wins only when its normalized
  email also matches; an ambiguous fallback fails closed
- `src/app/api/auth/register/route.ts` — existence check and create
- `src/app/api/auth/mobile/login/route.ts` — login lookup

Migration `20260917070000_email_case_insensitive_index` adds a **non-unique**
`lower(email)` index.

## Not done yet — deliberately

The duplicate rows are untouched. No merge, no delete, no reassignment.

A unique index cannot be created while they exist; verified against production:

```
ERROR:  could not create unique index "users_email_lower_unique"
DETAIL:  Key (lower(email))=(rustyadj@gmail.com) is duplicated.
```

## Exact reconciliation procedure — approval required, do not run casually

The current production facts verified read-only on 2026-09-20 are:

- source/original credentials id: `cmqyvtod10000jv013gcp11n5`
- survivor/social id: `cmse53o8h01app4014ql3kqh8`
- the survivor owns the existing Sentinel project and current OAuth tokens;
  the source owns four workspaces and the only password hash

Take a database snapshot first. Stop app and worker writes for the short
transaction. Re-run the preflight below and have the owner approve the two ids
and the lowercase survivor. The transaction deliberately does not delete the
source user: deletion has cascading relationships and is not needed.

```sql
-- PRE-FLIGHT (read only)
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SELECT id, email, "passwordHash" IS NOT NULL AS has_password, "createdAt"
FROM users WHERE lower(email) = 'rustyadj@gmail.com' ORDER BY "createdAt";

SELECT 'projects' table_name, count(*) FROM projects WHERE "userId" IN
 ('cmqyvtod10000jv013gcp11n5','cmse53o8h01app4014ql3kqh8') UNION ALL
SELECT 'workspaces', count(*) FROM workspaces WHERE "ownerId" IN
 ('cmqyvtod10000jv013gcp11n5','cmse53o8h01app4014ql3kqh8') UNION ALL
SELECT 'role_assignments', count(*) FROM role_assignments WHERE "userId" IN
 ('cmqyvtod10000jv013gcp11n5','cmse53o8h01app4014ql3kqh8') UNION ALL
SELECT 'oauth_access_tokens', count(*) FROM oauth_access_tokens WHERE "userId" IN
 ('cmqyvtod10000jv013gcp11n5','cmse53o8h01app4014ql3kqh8') UNION ALL
SELECT 'orchestration_runs', count(*) FROM orchestration_runs WHERE "userId" IN
 ('cmqyvtod10000jv013gcp11n5','cmse53o8h01app4014ql3kqh8');

-- This must return zero rows. Resolve any collision by human review first.
SELECT a."sourceType", a."sourceId", a.id source_id, b.id survivor_id
FROM knowledge_objects a JOIN knowledge_objects b
  ON a."sourceType"=b."sourceType" AND a."sourceId"=b."sourceId"
WHERE a."userId"='cmqyvtod10000jv013gcp11n5'
  AND b."userId"='cmse53o8h01app4014ql3kqh8';
ROLLBACK;
```

After snapshot, maintenance mode, preflight, and explicit owner approval, run
the following as one transaction. Check every affected-row count before
`COMMIT`; use `ROLLBACK` on any surprise.

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT pg_advisory_xact_lock(hashtext('sentinel:user-identity-reconcile'));
SELECT id, email FROM users
WHERE id IN ('cmqyvtod10000jv013gcp11n5','cmse53o8h01app4014ql3kqh8')
FOR UPDATE;

-- Preserve credentials and the best available display name on the survivor.
UPDATE users survivor SET
  "passwordHash" = COALESCE(survivor."passwordHash", source."passwordHash"),
  name = COALESCE(survivor.name, source.name)
FROM users source
WHERE survivor.id='cmse53o8h01app4014ql3kqh8'
  AND source.id='cmqyvtod10000jv013gcp11n5';

UPDATE projects SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE chat_rooms SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE workflows SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE obsidian_notes SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE audit_logs SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE workspaces SET "ownerId"='cmse53o8h01app4014ql3kqh8' WHERE "ownerId"='cmqyvtod10000jv013gcp11n5';
UPDATE role_assignments SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE role_assignments SET "delegatedById"='cmse53o8h01app4014ql3kqh8' WHERE "delegatedById"='cmqyvtod10000jv013gcp11n5';
UPDATE approval_requests SET "requesterUserId"='cmse53o8h01app4014ql3kqh8' WHERE "requesterUserId"='cmqyvtod10000jv013gcp11n5';
UPDATE approval_requests SET "reviewerUserId"='cmse53o8h01app4014ql3kqh8' WHERE "reviewerUserId"='cmqyvtod10000jv013gcp11n5';
UPDATE meetings SET "createdById"='cmse53o8h01app4014ql3kqh8' WHERE "createdById"='cmqyvtod10000jv013gcp11n5';
UPDATE knowledge_objects SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE creator_studio_brands SET "ownerId"='cmse53o8h01app4014ql3kqh8' WHERE "ownerId"='cmqyvtod10000jv013gcp11n5';
UPDATE external_clients SET "createdByUserId"='cmse53o8h01app4014ql3kqh8' WHERE "createdByUserId"='cmqyvtod10000jv013gcp11n5';
UPDATE oauth_authorization_codes SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE oauth_access_tokens SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE oauth_refresh_tokens SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';
UPDATE orchestration_runs SET "userId"='cmse53o8h01app4014ql3kqh8' WHERE "userId"='cmqyvtod10000jv013gcp11n5';

-- Retain the emptied source as a non-authenticating tombstone.
UPDATE users SET
  email='reconciled+cmqyvtod10000jv013gcp11n5@invalid.sentinel.local',
  "passwordHash"=NULL,
  name=COALESCE(name,'Reconciled identity') || ' (reconciled)'
WHERE id='cmqyvtod10000jv013gcp11n5';

DROP INDEX IF EXISTS "users_email_lower_idx";
CREATE UNIQUE INDEX "users_email_lower_key" ON users (lower(email));

-- Must be 1, and all source foreign-key counts must now be 0.
SELECT count(*) FROM users WHERE lower(email)='rustyadj@gmail.com';
COMMIT;
```

Afterward, restart the app/worker, revoke the owner's pre-reconciliation OAuth
token families, sign in once, and run the canonical MCP probe. Revocation is
important: an old bearer token remains bound to the tombstoned id otherwise.
