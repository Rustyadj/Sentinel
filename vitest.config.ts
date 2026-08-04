import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // runtime-agents/ (bind-mounted claude/codex binaries + copied host
    // credentials — see docker-compose.yml) and runtime-projects/ (CLI job
    // working directory) are gitignored deployment data, not source, but
    // they still exist on disk locally and vitest's default discovery
    // walks them — confirmed runtime-agents/.../node_modules ships its own
    // *.test.mjs fixtures that aren't vitest-compatible.
    exclude: ["**/node_modules/**", "**/.next/**", "tests/e2e/**", "runtime-agents/**", "runtime-projects/**"],
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
