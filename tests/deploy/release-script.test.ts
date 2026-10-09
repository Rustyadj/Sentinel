// scripts/deploy/release.sh against a fake docker/curl and a real throwaway git repo.
// What matters here is ordering and refusal: nothing running is touched before the gates
// pass, a failed migration starts nothing, a half-updated or unhealthy release is
// rolled back to the revision that was actually running, and no step prints secrets.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const SCRIPT = resolve(__dirname, "../../scripts/deploy/release.sh");
const FAKE_DOCKER = readFileSync(resolve(__dirname, "fake-docker.sh"), "utf8");
const FAKE_CURL = readFileSync(resolve(__dirname, "fake-curl.sh"), "utf8");
let root: string; let remote: string; let app: string; let fake: string; let bin: string;
let shaOld: string; let shaNew: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const commit = (cwd: string, name: string) => { writeFileSync(join(cwd, name), name); git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", name); return git(cwd, "rev-parse", "HEAD"); };
const calls = () => (existsSync(join(fake, "calls.log")) ? readFileSync(join(fake, "calls.log"), "utf8").split("\n").filter(Boolean) : []);
const events = () => (existsSync(join(fake, "events.log")) ? readFileSync(join(fake, "events.log"), "utf8").split("\n").filter(Boolean) : []);
const running = (service: string) => (existsSync(join(fake, `svc.${service}.sha`)) ? readFileSync(join(fake, `svc.${service}.sha`), "utf8").trim() : null);
const setRunning = (sha: string) => { for (const s of ["app", "learning-worker", "orchestration-worker"]) writeFileSync(join(fake, `svc.${s}.sha`), `${sha}\n`); };

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: app, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: app, FAKE_STATE: fake, SENTINEL_HEALTH_ATTEMPTS: "2", SENTINEL_HEALTH_INTERVAL: "0", ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "release-"));
  remote = join(root, "remote.git"); app = join(root, "app"); fake = join(root, "fake"); bin = join(root, "bin");
  for (const d of [fake, bin]) mkdirSync(d);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER); writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "docker"), 0o755); chmodSync(join(bin, "curl"), 0o755);
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, app);
  // The workflow streams the script out of the release commit, so the commits must carry it.
  mkdirSync(join(app, "scripts/deploy"), { recursive: true });
  writeFileSync(join(app, "scripts/deploy/release.sh"), readFileSync(SCRIPT));
  shaOld = commit(app, "old"); git(app, "push", "-q", "origin", "HEAD:main");
  shaNew = commit(app, "new"); git(app, "push", "-q", "origin", "HEAD:main");
  git(app, "checkout", "-q", "--detach", shaOld);
  writeFileSync(join(app, ".env"), "AUTH_SECRET=SUPER-SECRET-VALUE\n");   // untracked, as on the host
  setRunning(shaOld);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("deploy", () => {
  it("builds every image, migrates, starts app and both workers on the one revision, and verifies it", () => {
    const { status, out } = run(["deploy", shaNew]);
    expect(out).toContain("deployed immutable release");
    expect(status).toBe(0);

    const builds = calls().filter((c) => c.includes(" build ") || c.startsWith("compose build"));
    expect(builds).toHaveLength(1);
    for (const service of ["app", "migrate", "learning-worker", "orchestration-worker"]) expect(builds[0]).toContain(service);

    expect(events()).toEqual(["migrated", `up app ${shaNew}`, `up learning-worker ${shaNew}`, `up orchestration-worker ${shaNew}`]);
    expect([running("app"), running("learning-worker"), running("orchestration-worker")]).toEqual([shaNew, shaNew, shaNew]);
    expect(git(app, "rev-parse", "HEAD")).toBe(shaNew);

    const releases = join(app, "backups/releases"); const [dir] = readdirSync(releases);
    expect(JSON.parse(readFileSync(join(releases, dir, "release.json"), "utf8"))).toMatchObject({ release: shaNew, previous: shaOld });
    expect(readFileSync(join(releases, dir, "postgres.dump")).length).toBeGreaterThan(1024);
  });

  it("never prints the compose config or the environment", () => {
    const { out } = run(["deploy", shaNew]);
    expect(out).not.toContain("SUPER-SECRET-VALUE");
    expect(calls().every((c) => !c.startsWith("compose config") || c.includes("--quiet"))).toBe(true);
  });

  it("refuses a dirty checkout before touching anything", () => {
    writeFileSync(join(app, "old"), "locally edited");
    const { status, out } = run(["deploy", shaNew]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/uncommitted changes/);
    expect(calls().some((c) => c.startsWith("compose up") || c.startsWith("compose build"))).toBe(false);
    expect(running("app")).toBe(shaOld);
  });

  it("refuses a sha that is not the head of origin/main", () => {
    const { status, out } = run(["deploy", shaOld]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/not the head of origin\/main/);
    expect(calls().some((c) => c.startsWith("compose build"))).toBe(false);
  });

  it("refuses anything but a full sha", () => {
    expect(run(["deploy", "main"]).out).toMatch(/full 40-character/);
    expect(run(["deploy", shaNew.slice(0, 7)]).out).toMatch(/full 40-character/);
    expect(run(["deploy"]).status).not.toBe(0);
  });

  it("refuses to deploy without a restorable database backup", () => {
    const { status, out } = run(["deploy", shaNew], { FAKE_BAD_DUMP: "1" });
    expect(status).not.toBe(0);
    expect(out).toMatch(/not a readable archive/);
    expect(events()).toEqual([]);
    expect(running("app")).toBe(shaOld);
  });

  it("a failed migration starts nothing and puts the checkout back", () => {
    const { status } = run(["deploy", shaNew], { FAKE_MIGRATE_FAIL: "1" });
    expect(status).not.toBe(0);
    expect(events().filter((e) => e.startsWith("up "))).toEqual([]);
    expect([running("app"), running("learning-worker"), running("orchestration-worker")]).toEqual([shaOld, shaOld, shaOld]);
    expect(git(app, "rev-parse", "HEAD")).toBe(shaOld);
  });

  it("a failed build changes nothing that is running", () => {
    const { status } = run(["deploy", shaNew], { FAKE_BUILD_FAIL: "1" });
    expect(status).not.toBe(0);
    expect(events()).toEqual([]);
    expect(running("app")).toBe(shaOld);
  });

  it("rolls EVERY service back when a worker never becomes healthy", () => {
    const { status, out } = run(["deploy", shaNew], { FAKE_UNHEALTHY: "orchestration-worker", FAKE_UNHEALTHY_SHA: shaNew });
    expect(status).not.toBe(0);
    expect(out).toMatch(/rolling every service back/);
    expect([running("app"), running("learning-worker"), running("orchestration-worker")]).toEqual([shaOld, shaOld, shaOld]);
    expect(git(app, "rev-parse", "HEAD")).toBe(shaOld);
    // the rollback did not migrate again
    expect(events().filter((e) => e === "migrated")).toHaveLength(1);
  });

  it("refuses to call a mixed-revision release deployed: a worker still on the old code fails verification", () => {
    const { status, out } = run(["deploy", shaNew], { FAKE_ENV_COMMIT_learning_worker: shaOld });
    expect(status).not.toBe(0);
    expect(out).toMatch(/FAIL learning-worker: SENTINEL_COMMIT is/);
  });

  it("does not trust /api/version alone", () => {
    const { status, out } = run(["deploy", shaNew], { FAKE_VERSION_LIE: shaOld });
    expect(status).not.toBe(0);
    expect(out).toMatch(/api\/version reports/);
  });

  it("rolls back to the revision that was RUNNING, not the one that happened to be checked out", () => {
    // Production reality: the checkout said one thing and the container another.
    git(app, "checkout", "-q", "--detach", shaNew);
    setRunning(shaOld);
    const { status } = run(["deploy", shaNew], { FAKE_UNHEALTHY: "app", FAKE_UNHEALTHY_SHA: shaNew });
    expect(status).not.toBe(0);
    expect([running("app"), running("learning-worker"), running("orchestration-worker")]).toEqual([shaOld, shaOld, shaOld]);
  });
});

describe("rollback", () => {
  it("restores app and both workers to the target revision without running a migration", () => {
    setRunning(shaNew);
    const { status } = run(["rollback", shaOld]);
    expect(status).toBe(0);
    expect([running("app"), running("learning-worker"), running("orchestration-worker")]).toEqual([shaOld, shaOld, shaOld]);
    expect(events().filter((e) => e === "migrated")).toEqual([]);
    expect(calls().some((c) => c.startsWith("compose run"))).toBe(false);
  });

  it("refuses a revision that is not in the checkout", () => {
    const { status, out } = run(["rollback", "0".repeat(40)]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/not a commit/);
  });
});

describe("verify", () => {
  it("passes only when app and both workers all report the revision", () => {
    setRunning(shaNew);
    expect(run(["verify", shaNew]).status).toBe(0);
    expect(run(["verify", shaOld]).status).not.toBe(0);
  });
});

describe("the workflow's deploy step", () => {
  it("streams the script from the release commit over ssh and deploys exactly that sha", () => {
    const workflow = parseYaml(readFileSync(resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8"));
    const step = workflow.jobs["deploy-production"].steps.find((candidate: { name: string }) => candidate.name.startsWith("Back up and deploy"));
    // The "ssh" the step runs: execute whatever it is sent, on this machine, where the host's checkout is.
    writeFileSync(join(bin, "ssh"), `#!/usr/bin/env bash\nwhile [ "$#" -gt 1 ]; do shift; done\nexec bash -s\n`);
    chmodSync(join(bin, "ssh"), 0o755);
    const result = spawnSync("bash", ["-c", step.run], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root, FAKE_STATE: fake, SENTINEL_HEALTH_ATTEMPTS: "2", SENTINEL_HEALTH_INTERVAL: "0",
        VPS_HOST: "h", VPS_USER: "u", VPS_SSH_PORT: "22", VPS_APP_DIR: app, RELEASE_SHA: shaNew },
    });
    expect(`${result.stdout}${result.stderr}`).toContain(`deployed immutable release ${shaNew}`);
    expect(result.status).toBe(0);
    expect([running("app"), running("learning-worker"), running("orchestration-worker")]).toEqual([shaNew, shaNew, shaNew]);
  });

  it("deploys only on request: dispatch, or a push to main while SENTINEL_AUTODEPLOY is true", () => {
    const workflow = parseYaml(readFileSync(resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8"));
    const job = workflow.jobs["deploy-production"];
    expect(job.environment).toBe("production");
    expect(job.needs).toBe("deploy-gate");
    const condition = String(job.if).replace(/\s+/g, " ");
    expect(condition).toContain("github.ref == 'refs/heads/main'");
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain("vars.SENTINEL_AUTODEPLOY == 'true'");
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(["pull_request", "push", "workflow_dispatch"]));
  });
});
