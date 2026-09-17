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

## Fixed (2026-09-17)

`src/lib/auth/email.ts` normalizes to trimmed lowercase, and all five sites now
use it:

- `src/auth.ts` — Credentials `authorize()` lookup
- `src/auth.ts` — `jwt` callback upsert (the site that created the duplicate)
- `src/lib/current-user.ts` — `requireUser()` upsert, plus a case-insensitive
  comparison so an existing differently-cased row is not bypassed
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

## Follow-up, in order

1. Reconcile the duplicate (owner decision; keep **lowercase** as survivor —
   it holds the OAuth/MCP tokens and is what social login keeps producing).
   Moves ~13 rows: 4 `workspaces.ownerId`, 2 `chat_rooms.userId`, ~10
   redundant/duplicate `role_assignments`, and renames the capital-R row.
   Never `DELETE` the capital-R user: `workspaces.ownerId` is
   `onDelete: Cascade`, so deleting it would destroy the four workspaces.
2. Then promote the index:

```sql
DROP INDEX "users_email_lower_idx";
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
```

Until step 2, application-level normalization is the only guarantee against a
new case-only duplicate. That is sufficient because all five entry points now
normalize, but it is not enforced by the database.
