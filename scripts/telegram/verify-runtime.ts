/** Read-only protocol canary: creates an empty Hermes session, submits no model prompt. */
import { randomBytes } from "node:crypto";
import { db } from "../../src/lib/db";
import { getRuntimeView } from "../../src/lib/agents/runtime/service";
import { hermesAuth } from "../../src/lib/agents/runtime/hermes";
import { HermesWebSocketClient } from "../../src/lib/agents/runtime/transports/hermes-websocket";
import { verifyTelegramRuntimeGate } from "../../src/lib/telegram/gate";
import { expectedAgent } from "../../src/lib/telegram/policy";
async function main() {
  const key = process.argv[2]; const agentId = `hermes-${key}`; expectedAgent(key, agentId);
  const runtime = await getRuntimeView(agentId); if (!runtime?.endpoint || !runtime.enabled) throw new Error("Runtime unavailable");
  const prefix = agentId.replaceAll("-", "_").toUpperCase(); const profile = process.env[`${prefix}_TELEGRAM_PROFILE`];
  if (!profile) throw new Error("Managed profile missing");
  const auth = hermesAuth(agentId); const client = await HermesWebSocketClient.connect(runtime.endpoint, fetch, 10000, auth.token, auth.credentials);
  try {
    const source = `sentinel-telegram:c${randomBytes(12).toString("hex")}`;
    const session = await client.call<{ session_id: string }>("session.create", { source, profile });
    await verifyTelegramRuntimeGate(client, session.session_id, profile, source);
    await client.call("session.interrupt", { session_id: session.session_id });
    console.log(JSON.stringify({ agentId, profile, gateProtocolVerified: true, modelPromptSubmitted: false }));
  } finally { client.close(); }
}
main().catch(() => { console.error("Trusted runtime verification failed. No model prompt was submitted; inspect managed profile/gate configuration."); process.exitCode = 1; }).finally(() => db.$disconnect());
