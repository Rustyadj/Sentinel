// Strip deployment-specific overrides before any module reads process.env.
//
// Vitest loads the project root's .env into process.env, so this host's
// production values leak into assertions about built-in defaults. config.ts
// resolves `process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4862"` at import
// time, and .env sets HERMES_ENDPOINT to the live Lisa URL — so
// execution-verification.test.ts failed against the very default it exists to
// pin, purely because of which machine it ran on.
//
// This runs as a setup file, which executes before the test module graph is
// imported, so the deletions land before any module-scope read. Values the
// suite genuinely needs are set explicitly in vitest.config.ts under
// `test.env`; anything listed here is deployment configuration that tests must
// not inherit.
const DEPLOYMENT_ONLY_KEYS = [
  "HERMES_ENDPOINT",
  "HERMES_NATHAN2_ENDPOINT",
  "HERMES_LISA_CONTAINER",
  "OPENCLAW_ENDPOINT",
  "OPENCLAW_GATEWAY_URL",
];

for (const key of DEPLOYMENT_ONLY_KEYS) {
  delete process.env[key];
}
