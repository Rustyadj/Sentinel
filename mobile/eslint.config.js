// This app's own eslint config — deliberately not inherited from the repo
// root's eslint.config.mjs (which is a Next.js/web config and explicitly
// excludes mobile/, see its globalIgnores). Without a config here, flat
// ESLint's directory-walk-up resolution would otherwise fall through to the
// root config and find nothing but ignores. This is the standard scaffold
// `expo lint` generates for a fresh SDK 57 project.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat.js");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
]);
