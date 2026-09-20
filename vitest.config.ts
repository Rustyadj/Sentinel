import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Set before anything imports @/lib/db (or tests/global-setup.ts, which vitest
// loads in *this* process and which therefore never sees `test.env` below).
// Without this the suite silently resolves DATABASE_URL from .env — the live
// application database.
const TEST_DATABASE_URL =
  process.env.SENTINEL_TEST_DATABASE_URL ??
  "postgresql://postgres:sentinel_test@127.0.0.1:55439/sentinel_vitest";
process.env.DATABASE_URL = TEST_DATABASE_URL;

// Likewise a throwaway Redis, never the application's. Several suites enqueue
// real BullMQ jobs; pointing them at the live instance would inject test jobs
// into the running learning/orchestration workers.
const TEST_REDIS_URL = process.env.SENTINEL_TEST_REDIS_URL ?? "redis://127.0.0.1:55480";
process.env.REDIS_URL = TEST_REDIS_URL;

// A throwaway Redis is not isolation on its own: anything else may be pointed
// at the same instance. A leftover worker:orchestration process from another
// checkout was doing exactly that -- it consumed the queue test's job, failed
// it against its own database and held the lock, which surfaced as the
// long-standing "could not be removed because it is locked by another worker"
// failure. Namespacing every BullMQ key puts the suite's queues out of reach
// of any worker that does not share this prefix.
const TEST_QUEUE_PREFIX = process.env.SENTINEL_TEST_BULLMQ_PREFIX ?? "bull-vitest";
process.env.BULLMQ_PREFIX = TEST_QUEUE_PREFIX;


export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // next@16.2.9 ships no "exports" map, so the bare specifier "next/server"
      // (used internally by next-auth's lib/env.js) can't be resolved under
      // strict ESM resolution — Node has no exports entry to consult and
      // doesn't extension-probe bare specifiers the way CJS `require` does.
      // Pointing it at the real file sidesteps the ambiguity entirely.
      "next/server": fileURLToPath(new URL("./node_modules/next/server.js", import.meta.url)),
    },
  },
  test: {
    // Tests run against a dedicated throwaway database, never the live one.
    // Before this, vitest shared DATABASE_URL with the running app, and
    // tests/global-setup.ts existed only to paper over the damage that
    // caused (it documents runtime-codex/runtime-claude-code having been
    // left pointing at deleted test workspaces *in production*).
    // Override SENTINEL_TEST_DATABASE_URL to point elsewhere.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      BULLMQ_PREFIX: TEST_QUEUE_PREFIX,
    },
    environment: "jsdom",
    setupFiles: ["./tests/env-isolation.ts", "./src/test/setup.ts"],
    // Snapshots/restores the static agent_runtimes rows (runtime-codex,
    // runtime-claude-code, ...) around the whole run — several suites
    // repoint them at throwaway per-test workspaces, and with no separate
    // test database that otherwise permanently breaks those runtimes for
    // real users. See tests/global-setup.ts.
    ...(process.env.VITEST_NO_DB_SETUP ? {} : { globalSetup: ["./tests/global-setup.ts"] }),
    css: true,
    // runtime-agents/ (bind-mounted claude/codex binaries + copied host
    // credentials — see docker-compose.yml) and runtime-projects/ (CLI job
    // working directory) are gitignored deployment data, not source, but
    // they still exist on disk locally and vitest's default discovery
    // walks them — confirmed runtime-agents/.../node_modules ships its own
    // *.test.mjs fixtures that aren't vitest-compatible.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "tests/e2e/**",
      "runtime-agents/**",
      "runtime-projects/**",
      // mobile/ is a separate Expo app; it has no vitest-runnable tests today
      // and isn't meant to share this project's jsdom/next-auth test setup.
      "mobile/**",
    ],
    fileParallelism: false,
    // Without this, vitest treats next-auth as SSR-external and loads it via
    // Node's native resolver, which skips the alias above entirely — same
    // "next/server" resolution failure reappears even with the alias set.
    server: {
      deps: {
        inline: ["next-auth"],
      },
    },
  },
});
