/** Live provider acceptance. Point DATABASE_URL at the isolated acceptance DB, never reset production. */
import { db } from "../src/lib/db";
import { getRuntimeAdapter, getRuntimeView } from "../src/lib/agents/runtime/service";
import { runtimeEventText } from "../src/lib/agents/runtime/chat-routing";
import { sentinelModelDefault } from "../src/lib/agents/model-policy";

async function main() {
  if (!process.env.DATABASE_URL?.includes("sentinel_test")) throw new Error("Acceptance requires isolated sentinel_test database");
  const user = await db.user.upsert({ where: { email: "runtime-acceptance@sentinel.test" }, create: { email: "runtime-acceptance@sentinel.test" }, update: {} });
  const workspace = await db.workspace.upsert({ where: { slug: "model-acceptance" }, create: { slug: "model-acceptance", name: "Model acceptance", ownerId: user.id }, update: {} });
  for (const agentId of (process.env.ACCEPTANCE_AGENTS ?? "hermes-lisa,hermes-nathan2,claude-code,codex").split(",")) {
    const kind = agentId.startsWith("hermes-") ? "hermes" : agentId as "claude-code" | "codex";
    const defaults = sentinelModelDefault(kind);
    await db.agent.upsert({ where: { id: agentId }, create: { id: agentId, name: agentId, role: "assistant", avatar: "🤖", color: "#6366f1", model: defaults.runtimeModelId, reasoningEffort: defaults.effort, workspaceId: workspace.id }, update: { model: defaults.runtimeModelId, reasoningEffort: defaults.effort, workspaceId: workspace.id } });
    await db.agentRuntime.update({ where: { id: `runtime-${agentId}` }, data: { workspaceId: workspace.id } });
    const runtime = (await getRuntimeView(agentId))!;
    const adapter = getRuntimeAdapter(kind);
    let sessionId: string | undefined;
    try {
      console.log(JSON.stringify({ agentId, health: await adapter.health(runtime), discovery: await adapter.discover() }));
      const session = await adapter.startSession({ runtimeId: runtime.id, userId: user.id, workspaceId: workspace.id, workingDirectory: runtime.workingDirectoryRoot });
      sessionId = session.id;
      const events: string[] = []; let text = "";
      const timer = setTimeout(() => { void adapter.cancel(session.id); }, 45000);
      try {
        for await (const event of adapter.send({ sessionId: session.id, userId: user.id, prompt: "Reply exactly SENTINEL_MODEL_ACCEPTANCE_OK. Do not use tools or change files." })) {
          events.push(event.type); text += runtimeEventText(event);
          if (event.type === "error") console.log(JSON.stringify({ agentId, error: event.data }));
        }
      } finally { clearTimeout(timer); }
      console.log(JSON.stringify({ agentId, session: await adapter.getSession(session.id), eventTypes: [...new Set(events)], response: text.slice(0, 300) }));
      // Exercise cancellation on a distinct new session, never mutate the completed one.
      const cancelSession = await adapter.startSession({ runtimeId: runtime.id, userId: user.id, workspaceId: workspace.id, workingDirectory: runtime.workingDirectoryRoot });
      let requested = false;
      for await (const event of adapter.send({ sessionId: cancelSession.id, userId: user.id, prompt: "Without tools, write a detailed 3000-word explanation of sorting algorithms." })) {
        if (!requested && ["assistant_delta", "stdout", "status"].includes(event.type)) {
          requested = true;
          console.log(JSON.stringify({ agentId, cancellation: await adapter.cancel(cancelSession.id) }));
        }
      }
    } catch (error) {
      console.log(JSON.stringify({ agentId, sessionId, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  await db.$disconnect();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
