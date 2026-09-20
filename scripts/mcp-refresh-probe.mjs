#!/usr/bin/env node
console.error("This database-seeded probe was retired. Refresh rotation is covered by the canonical external-client probe:");
console.error("  npm run probe:mcp -- --base <origin>");
process.exitCode = 2;
