#!/usr/bin/env node
console.error("This database-seeded probe was retired. Use the public-interface canonical probe instead:");
console.error("  npm run probe:mcp -- --base <origin>");
process.exitCode = 2;
