import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".claude/**",
    "next-env.d.ts",
    // mobile/ is a separate Expo/React Native app with its own toolchain
    // (its own tsconfig, its own `expo lint`, React Native globals like
    // `__DEV__`) — linting it with the Next.js web config here produces
    // nothing but false positives.
    "mobile/**",
    // Deployment-only runtime binaries, credentials, plugin caches, and
    // agent workspaces are mounted below the checkout and are not app source.
    "runtime-agents/**",
    "runtime-projects/**",
  ]),
]);

export default eslintConfig;
