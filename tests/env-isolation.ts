// Pin deployment-specific overrides to their built-in defaults before any
// module reads process.env.
//
// Vitest loads the project root's .env into process.env, so this host's
// production values leak into assertions about built-in defaults. config.ts
// resolves `process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4862"` at import
// time, and .env sets HERMES_ENDPOINT to the live Lisa URL — so
// execution-verification.test.ts failed against the very default it exists to
// pin, purely because of which machine it ran on.
//
// This runs as a setup file, which executes before the test module graph is
// imported, so it lands before any module-scope read. Values the suite
// genuinely needs are set explicitly in vitest.config.ts under `test.env`;
// anything listed here is deployment configuration that tests must not inherit.
//
// Why assign instead of delete: deleting is not enough. @prisma/client runs
// dotenv on import, so the moment a test's module graph reaches Prisma — as
// hermes-nathan2.test.ts does via ./hermes -> ./store -> the Prisma client —
// every key we deleted is re-read straight back out of .env. dotenv does not
// overwrite a key that is already set, so pinning the canonical default keeps
// it pinned no matter where in the graph .env gets loaded again. The pinned
// value is the same one the `?? default` branch would have produced, so tests
// still observe default behaviour.
const DEPLOYMENT_DEFAULTS: Record<string, string> = {
  HERMES_ENDPOINT: "http://127.0.0.1:4862",
  HERMES_NATHAN2_ENDPOINT: "http://127.0.0.1:4864",
  HERMES_LISA_CONTAINER: "hermes-lisa",
  OPENCLAW_ENDPOINT: "http://127.0.0.1:18789/readyz",
  // No built-in default: the only reader treats an empty string exactly as it
  // treats an unset value (`process.env.OPENCLAW_GATEWAY_URL?.trim()`).
  OPENCLAW_GATEWAY_URL: "",
};

for (const [key, value] of Object.entries(DEPLOYMENT_DEFAULTS)) {
  process.env[key] = value;
}
