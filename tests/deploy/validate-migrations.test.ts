// scripts/deploy/validate-migrations.sh against a fake docker/npx (no Postgres, no network) and a real throwaway git
// repo. The script's job is to refuse; these tests are its failure paths. A validator that passes everything proves
// nothing, so each guard below has a case where it must say no, next to the case where the same input must say yes.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/deploy/validate-migrations.sh");

// The fake answers every `docker exec ... psql -c "/*marker*/ ..."` from <state>/q/<marker>[.<nth call>].
const FAKE_DOCKER = `#!/usr/bin/env bash
S="$FAKE_STATE"; echo "$*" >> "$S/docker.log"
case "$1" in run|rm) exit 0 ;; esac
[ "$1" = exec ] || exit 0
shift; [ "$1" = -i ] && { shift; cat >/dev/null; }
shift
case "$1" in pg_isready|createdb|pg_restore) exit 0 ;; esac
sql=""; while [ $# -gt 0 ]; do [ "$1" = -c ] && sql="$2"; shift; done
marker="$(printf '%s' "$sql" | sed -n 's#^/\\*\\([a-z-]*\\)\\*/.*#\\1#p')"
n=$(( $(cat "$S/n.$marker" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/n.$marker"
for f in "$S/q/$marker.$n" "$S/q/$marker"; do [ -f "$f" ] && { cat "$f"; exit 0; }; done
exit 0
`;

const FAKE_NPX = `#!/usr/bin/env bash
S="$FAKE_STATE"; echo "$DATABASE_URL" >> "$S/npx.urls"; echo "$*" >> "$S/npx.log"
[ "$1" = prisma ] || exit 0
case "$2 $3" in
  "migrate deploy")
    case " $* " in
      *" --schema "*) cat "$S/base-deploy.out" 2>/dev/null || echo "No pending migrations to apply."; exit 0 ;;
    esac
    cat "$S/deploy.out" 2>/dev/null; exit "$(cat "$S/deploy.rc" 2>/dev/null || echo 0)" ;;
  "migrate status") echo "Database schema is up to date!"; exit 0 ;;
  "migrate diff")
    label=drift-after
    case " $* " in *"/hermes_pre"*) label=drift-before ;; *"base-schema.prisma"*) label=old-app ;; esac
    [ -f "$S/diff.$label.out" ] && cat "$S/diff.$label.out"
    [ -f "$S/diff.$label.err" ] && cat "$S/diff.$label.err" >&2
    exit "$(cat "$S/diff.$label.rc" 2>/dev/null || echo 0)" ;;
esac
exit 0
`;

let root: string; let repo: string; let state: string; let bin: string; let baseSha: string; let headSha: string;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const write = (path: string, content: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); };
const q = (marker: string, content: string, nth?: number) => write(join(state, "q", nth ? `${marker}.${nth}` : marker), content);
const fixture = (name: string, content: string) => write(join(state, name), content);

const M1 = "20260101000000_init"; const M2 = "20260201000000_more"; const M3 = "20261008000000_memory_expiry";
const SQL: Record<string, string> = { [M1]: "CREATE TABLE a ();\n", [M2]: "CREATE TABLE b ();\n", [M3]: "ALTER TABLE memories ADD COLUMN \"expiresAt\" TIMESTAMP;\n" };
const row = (name: string, over: { checksum?: string; finished?: boolean; rolledBack?: boolean } = {}) => `${name}|${over.checksum ?? sha(SQL[name] ?? "")}|${over.finished === false ? "f" : "t"}|${over.rolledBack ? "t" : "f"}`;
/** Production's _prisma_migrations as the script reads it. */
const applied = (...lines: string[]) => q("applied", lines.join("\n") + "\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migval-"));
  repo = join(root, "repo"); state = join(root, "state"); bin = join(root, "bin");
  for (const dir of [repo, state, bin, join(state, "q")]) mkdirSync(dir, { recursive: true });
  write(join(bin, "docker"), FAKE_DOCKER); write(join(bin, "npx"), FAKE_NPX);
  chmodSync(join(bin, "docker"), 0o755); chmodSync(join(bin, "npx"), 0o755);
  write(join(root, "prod.dump"), "dump");
  git("init", "-q", "-b", "main");
  write(join(repo, "prisma/schema.prisma"), "// base\n");
  for (const name of [M1, M2]) write(join(repo, "prisma/migrations", name, "migration.sql"), SQL[name]);
  write(join(repo, "prisma/migrations/migration_lock.toml"), "provider = \"postgresql\"\n");
  git("add", "-A"); git("commit", "-q", "-m", "base"); baseSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", baseSha);
  write(join(repo, "prisma/migrations", M3, "migration.sql"), SQL[M3]);
  write(join(repo, "prisma/schema.prisma"), "// head\n");
  git("add", "-A"); git("commit", "-q", "-m", "head"); headSha = git("rev-parse", "HEAD");
  // Healthy defaults: production runs the baseline, nothing in it is odd, the release only adds the retention column.
  applied(row(M1), row(M2));
  q("counts", "a=3\nb=4\n_prisma_migrations=2\n", 1); q("counts", "a=3\nb=4\n_prisma_migrations=3\n", 2);
  q("clock", "2026-10-09T10:00:00.000000\n", 1); q("clock", "2026-10-09T10:00:05.000000\n", 2);
  q("mem-pre", ""); q("mem-post", ""); q("mem-invariants", "0\n"); q("notnull", "0\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function validate(args: string[] = [], env: Record<string, string> = {}) {
  // Each run starts the fake's per-query call counters (counts #1/#2, clock #1/#2) from zero.
  for (const file of readdirSync(state)) if (file.startsWith("n.")) rmSync(join(state, file));
  for (const file of ["docker.log", "npx.urls", "npx.log"]) rmSync(join(state, file), { force: true });
  const result = spawnSync("bash", [SCRIPT, join(root, "prod.dump"), ...args], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STATE: state, MIGVAL_PORT: "55999", MIGVAL_CHECKSUM_EXCEPTIONS: join(root, "exceptions.txt"), ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}
const expectFail = (result: { status: number | null; out: string }, message: RegExp) => { expect(result.out).toMatch(message); expect(result.status).not.toBe(0); expect(result.out).not.toContain("All migration checks passed"); };

describe("a healthy release", () => {
  it("passes, says production was not contacted, and only ever used disposable local databases", () => {
    const result = validate([], { DATABASE_URL: "postgresql://prod-user:prod-secret@prod.internal:5432/hermesos", PGHOST: "prod.internal", DIRECT_URL: "postgresql://prod.internal/x" });
    expect(result.status).toBe(0);
    expect(result.out).toContain("All migration checks passed");
    const urls = readFileSync(join(state, "npx.urls"), "utf8").split("\n").filter(Boolean);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^postgresql:\/\/hermes:disposable@127\.0\.0\.1:55999\//);
    expect(readFileSync(join(state, "docker.log"), "utf8")).toContain("-p 127.0.0.1:55999:5432");
    expect(readFileSync(join(state, "docker.log"), "utf8")).toContain("rm -f");
    expect(result.out).not.toContain("prod-secret");
  });
});

describe("schema-diff commands", () => {
  it("fails when both diff commands fail with the SAME error (equal outputs must not read as 'no new drift')", () => {
    for (const label of ["drift-before", "drift-after"]) { fixture(`diff.${label}.rc`, "1"); fixture(`diff.${label}.err`, "Error: P1001 Can't reach database server\n"); }
    expectFail(validate(), /schema diff 'drift-before' failed[\s\S]*P1001/);
  });
  it("fails when only the after-diff errors", () => {
    fixture("diff.drift-after.rc", "1"); fixture("diff.drift-after.err", "Error: schema validation failed\n");
    expectFail(validate(), /schema diff 'drift-after' failed[\s\S]*schema validation failed/);
  });
  it("fails when the release changes the drift, and passes when production's own drift is unchanged", () => {
    fixture("diff.drift-before.out", "-- pre-existing\nDROP INDEX x;\n"); fixture("diff.drift-after.out", "-- pre-existing\nDROP INDEX x;\n");
    expect(validate().status).toBe(0);
    fixture("diff.drift-after.out", "-- pre-existing\nDROP INDEX x;\nALTER TABLE t ADD COLUMN c INT;\n");
    expectFail(validate(), /this release changes the drift/);
  });
});

describe("migration checksums", () => {
  const exceptionLine = (name: string, recorded: string, current: string, evidence = "reformatted in PR #12, content identical") => `${name} ${recorded} ${current} ${evidence}\n`;
  const editedInProduction = () => { applied(row(M1, { checksum: sha("what production really ran\n") }), row(M2)); };

  it("rejects a checksum that differs from production with no exception", () => {
    editedInProduction();
    expectFail(validate(), /UNEXPLAINED checksum difference: 20260101000000_init/);
  });
  it("accepts it only with a pinned, evidenced exception that the baseline already carried", () => {
    editedInProduction();
    write(join(root, "exceptions.txt"), exceptionLine(M1, sha("what production really ran\n"), sha(SQL[M1])));
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/excused historical checksum difference: 20260101000000_init — reformatted in PR #12/);
  });
  it("rejects an exception with no evidence", () => {
    editedInProduction();
    write(join(root, "exceptions.txt"), `${M1} ${sha("what production really ran\n")} ${sha(SQL[M1])}\n`);
    expectFail(validate(), /UNEXPLAINED/);
  });
  it("rejects an exception pinned to a different production checksum or file", () => {
    editedInProduction();
    write(join(root, "exceptions.txt"), exceptionLine(M1, sha("something else"), sha(SQL[M1])));
    expectFail(validate(), /UNEXPLAINED/);
    write(join(root, "exceptions.txt"), exceptionLine(M1, sha("what production really ran\n"), sha("not the file")));
    expectFail(validate(), /UNEXPLAINED/);
  });
  it("rejects an applied migration edited in THIS release even if an exception exists for the old file", () => {
    editedInProduction();
    write(join(repo, "prisma/migrations", M1, "migration.sql"), "CREATE TABLE a (extra int);\n");
    git("add", "-A"); git("commit", "-q", "-m", "edit applied migration");
    write(join(root, "exceptions.txt"), exceptionLine(M1, sha("what production really ran\n"), sha("CREATE TABLE a (extra int);\n")));
    expectFail(validate(), /NEW in this release[\s\S]*20260101000000_init/);
  });
  it("fails when an applied migration is absent from the checkout", () => {
    rmSync(join(repo, "prisma/migrations", M2), { recursive: true });       // production applied it, the baseline has it, this checkout lost it
    expectFail(validate(), /absent from this checkout: 20260201000000_more[\s\S]*1 applied migration\(s\) are missing/);
  });
});

describe("migration lineage", () => {
  it("fails on an unresolved failed migration record, and ignores one that was resolved as rolled back", () => {
    applied(row(M1), row(M2), row("20260215000000_half", { finished: false }));
    expectFail(validate(), /unresolved failed migration record\(s\): 20260215000000_half/);
    applied(row(M1), row(M2), row("20260215000000_half", { finished: false, rolledBack: true }));
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/1 rolled-back rows kept for history/);
  });
  it("refuses the default baseline when production runs something else, and says to name the right one", () => {
    applied(row(M1), row(M2), row("20260215000000_hotfix"));
    expectFail(validate(), /default baseline \(origin\/main\) is not what production runs; name the revision[\s\S]*second argument[\s\S]*20260215000000_hotfix/);
  });
  it("refuses a baseline that is missing something production applied, or has something production lacks", () => {
    applied(row(M1));
    expectFail(validate(), /In the baseline but not applied in production: 20260201000000_more/);
  });
  it("accepts an explicit baseline that matches production's lineage", () => {
    // Production already has M3 (the release being validated has nothing pending): the right baseline is the head.
    applied(row(M1), row(M2), row(M3));
    expectFail(validate(), /lineage differs/);                      // default origin/main lacks M3
    const result = validate([headSha]);
    expect(result.status).toBe(0);
    expect(result.out).toContain("retention backfill migration is not pending");
  });
  it("refuses an explicit baseline that does not describe production", () => {
    applied(row(M1), row(M2), row(M3));
    expectFail(validate([baseSha]), /'.*' does not describe what production runs/);
  });
  it("refuses a baseline that is not a revision at all", () => {
    expectFail(validate(["no-such-ref"]), /baseline 'no-such-ref' is not a revision/);
  });
});

describe("migrate deploy", () => {
  it("fails when migrate deploy fails on the production copy", () => {
    fixture("deploy.rc", "1"); fixture("deploy.out", "P3009 migrate found failed migrations\n");
    expectFail(validate(), /prisma migrate deploy failed/);
  });
  it("fails when existing row counts change", () => {
    q("counts", "a=3\nb=2\n_prisma_migrations=3\n", 2);
    expectFail(validate(), /row counts changed/);
  });
});

describe("retention backfill values", () => {
  const future = "2027-01-01T00:00:00.000000";
  const pre = (...rows: string[]) => q("mem-pre", rows.join("\n") + "\n");
  const post = (...rows: string[]) => q("mem-post", rows.join("\n") + "\n");

  it("passes when every candidate moved validTo into expiresAt and everything else is untouched", () => {
    pre(`m-bot|${future}|true`, `m-bot2|2027-02-02T00:00:00.000000|true`, `m-human|${future}|false`, `m-old|2020-01-01T00:00:00.000000|true`, "m-plain||false");
    post(`m-bot||${future}`, `m-bot2||2027-02-02T00:00:00.000000`, `m-human|${future}|`, `m-old|2020-01-01T00:00:00.000000|`, "m-plain||");
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/retention backfill correct for 2 memories/);
  });
  it("fails when a retention deadline was not moved (validTo kept, expiresAt empty)", () => {
    pre(`m-bot|${future}|true`);
    post(`m-bot|${future}|`);
    expectFail(validate(), /retention backfill produced wrong values[\s\S]*backfill wrong for m-bot/);
  });
  it("fails when expiresAt received the wrong value", () => {
    pre(`m-bot|${future}|true`);
    post("m-bot||2027-06-06T00:00:00.000000");
    expectFail(validate(), /backfill wrong for m-bot/);
  });
  it("fails when a non-candidate row (human memory, superseded, expired) was changed", () => {
    pre(`m-human|${future}|false`);
    post(`m-human||${future}`);
    expectFail(validate(), /row m-human should be untouched/);
    pre("m-old|2020-01-01T00:00:00.000000|true");
    post("m-old||2020-01-01T00:00:00.000000");
    expectFail(validate(), /row m-old should be untouched/);
  });
  it("fails when a memory disappeared", () => {
    pre(`m-bot|${future}|true`, "m-plain||false");
    post(`m-bot||${future}`);
    expectFail(validate(), /memory m-plain disappeared/);
  });
  it("fails when the invariant query finds an expiresAt that is not a bot retention deadline", () => {
    pre(`m-bot|${future}|true`);
    post(`m-bot||${future}`);
    q("mem-invariants", "2\n");
    expectFail(validate(), /retention invariant broken: 2 memories/);
  });
  it("accepts either state for a deadline that fell between the migration's start and end, but nothing else", () => {
    pre("m-edge|2026-10-09T10:00:02.000000|true");
    post("m-edge|2026-10-09T10:00:02.000000|");
    expect(validate().status).toBe(0);
    post("m-edge||2026-10-09T10:00:03.000000");
    expectFail(validate(), /boundary row m-edge in neither state/);
  });
  it("says so when the dump contains nothing the backfill could act on, rather than reporting a pass for it", () => {
    pre("m-plain||false"); post("m-plain||");
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/WARN .*backfill rule was NOT exercised/);
    expect(result.out).not.toMatch(/retention backfill correct/);
  });
});

describe("old-application compatibility", () => {
  it("accepts a schema difference that only DROPs what this release added", () => {
    fixture("diff.old-app.out", "-- DropForeignKey\nALTER TABLE \"bot_tool_grants\" DROP CONSTRAINT \"fk\";\n\n-- DropTable\nDROP TABLE \"bot_tool_grants\";\n\n-- AlterTable\nALTER TABLE \"memories\" DROP COLUMN \"expiresAt\";\n");
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/previous revision's schema fits the migrated database: 3 statement\(s\)/);
  });
  it("rejects a migration the previous revision cannot live with (a column it reads was removed or reshaped)", () => {
    for (const breaking of [
      "ALTER TABLE \"memories\" ADD COLUMN \"legacy\" TEXT;",
      "CREATE TABLE \"old_table\" (id TEXT);",
      "ALTER TABLE \"memories\" ALTER COLUMN \"content\" SET NOT NULL;",
      "ALTER TABLE \"memories\" ALTER COLUMN \"content\" SET DATA TYPE INTEGER;",
      "ALTER TABLE \"memories\" DROP COLUMN \"a\", ADD COLUMN \"b\" TEXT;",
      "ALTER TABLE \"memories\" RENAME COLUMN \"x\" TO \"y\";",
    ]) {
      fixture("diff.old-app.out", `DROP INDEX \"fine\";\n${breaking}\n`);
      expectFail(validate(), /previous revision \(origin\/main\) would not fit the migrated database/);
    }
  });
  it("rejects a NOT NULL column without a default added to an existing table (the old app's INSERTs would fail)", () => {
    fixture("diff.old-app.out", "ALTER TABLE \"memories\" DROP COLUMN \"expiresAt\";\n");
    q("notnull", "1\n");
    expectFail(validate(), /ADD COLUMN "expiresAt" is NOT NULL with no default/);
  });
  it("ignores differences production already had before this release", () => {
    fixture("diff.drift-before.out", "ALTER TABLE \"memories\" ADD COLUMN \"preexisting\" TEXT;\n"); fixture("diff.drift-after.out", "ALTER TABLE \"memories\" ADD COLUMN \"preexisting\" TEXT;\n");
    fixture("diff.old-app.out", "ALTER TABLE \"memories\" ADD COLUMN \"preexisting\" TEXT;\nDROP TABLE \"bot_tool_grants\";\n");
    expect(validate().status).toBe(0);
  });
  it("fails on an errored old-app diff rather than treating it as compatible", () => {
    fixture("diff.old-app.rc", "1"); fixture("diff.old-app.err", "Error: could not parse schema\n");
    expectFail(validate(), /schema diff 'old-app' failed/);
  });
  it("does not let a no-op 'migrate deploy' stand in for compatibility: the no-op is reported as names-only", () => {
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/compares names only and is not the compatibility check/);
    fixture("base-deploy.out", "Applying migration `20260301000000_x`\n");
    expectFail(validate(), /migrate deploy is not a no-op/);
  });
});

