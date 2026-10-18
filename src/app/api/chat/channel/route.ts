import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { routeRuntimeChat } from "@/lib/agents/runtime/chat-routing";
import { getRuntimeAdapter, getRuntimeView } from "@/lib/agents/runtime/service";
import { RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { redisAcquireLease, redisGet, redisReleaseLease, redisSet } from "@/lib/redis";
import { beginSystemOne, planForTurn } from "@/lib/system-one/turn";
import { RequestTrace, recordDecision } from "@/lib/system-one/telemetry";
import { observeRuntimeStream } from "@/lib/system-one/stream-observer";

const AGENT = "hermes-lisa";

/** Private machine ingress. A transport credential never selects a Sentinel user:
 * the operator's explicit platform/sender binding does, and workspace permissions
 * are checked again on every turn. Native gateway authorization runs first too. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.HERMES_CHANNEL_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || Buffer.byteLength(secret) !== Buffer.byteLength(supplied)
    || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const fields = ["platform", "senderId", "chatId", "messageId", "text"] as const;
  if (!body || fields.some(k => typeof body[k] !== "string" || !body[k].trim())
    || body.text.length > 100_000
    || fields.slice(0, 4).some(k => body[k].length > 256)
    || (body.threadId !== undefined && (typeof body.threadId !== "string" || body.threadId.length > 256))) {
    return Response.json({ error: "Invalid channel message" }, { status: 400 });
  }
  let bindings: Record<string, Record<string, string>>;
  try { bindings = JSON.parse(process.env.HERMES_CHANNEL_USERS ?? "{}"); }
  catch { return Response.json({ error: "Channel bindings unavailable" }, { status: 503 }); }
  const userId = Object.hasOwn(bindings, body.platform) && Object.hasOwn(bindings[body.platform], body.senderId)
    ? bindings[body.platform][body.senderId] : null;
  if (typeof userId !== "string" || !await db.user.findUnique({ where: { id: userId }, select: { id: true } })) {
    return Response.json({ error: "Sender is not connected to Sentinel" }, { status: 403 });
  }
  const runtime = await getRuntimeView("runtime-hermes-lisa");
  if (!runtime?.workspaceId || !await userHasWorkspacePermission(userId, runtime.workspaceId, RUNTIME_PERMISSIONS.execute)) {
    return Response.json({ error: "Runtime access denied" }, { status: 403 });
  }
  const hash = (parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const roomId = `channel-${hash([AGENT, userId, body.platform, body.senderId, body.chatId, body.threadId ?? ""])}`;
  const command = body.text.trim().toLowerCase();
  if (["/stop", "/new", "/reset"].includes(command)) {
    const sessions = await db.agentSession.findMany({ where: { chatRoomId: roomId, userId, runtimeInstanceId: runtime.id } });
    for (const session of sessions.filter(s => s.status === "running")) {
      const cancelled = await getRuntimeAdapter(runtime.kind).cancel(session.id);
      if (!cancelled.success) return Response.json({ error: "Sentinel could not stop this turn" }, { status: 503 });
    }
    if (command !== "/stop") {
      await db.agentSession.updateMany({ where: { chatRoomId: roomId, userId, runtimeInstanceId: runtime.id }, data: { chatRoomId: null } });
    }
    return Response.json({ text: command === "/stop" ? "Stopped the active Sentinel turn." : "Started a fresh Lisa conversation through Sentinel.", roomId });
  }
  const messageKey = `channel:message:${hash([roomId, body.messageId])}`;
  const cached = await redisGet(messageKey);
  if (cached) return Response.json(JSON.parse(cached));
  const lease = randomUUID();
  const roomKey = `channel:room:${roomId}`;
  if (!await redisAcquireLease(roomKey, lease, 1900)) {
    return Response.json({ error: "A Sentinel turn is already running; try again shortly" }, { status: 409 });
  }
  try {
    const prior = await redisGet(messageKey);
    if (prior) return Response.json(JSON.parse(prior));
    // Keep the receipt even after an uncertain failure: a delivery retry must
    // never execute the same real-world action twice.
    if (!await redisAcquireLease(`${messageKey}:receipt`, lease, 86400)) {
      return Response.json({ error: "This message was already submitted; check Sentinel before retrying" }, { status: 409 });
    }
    const room = await db.chatRoom.upsert({
      where: { id: roomId }, update: {},
      create: { id: roomId, name: `Lisa · ${body.platform}`, userId, agentIds: [AGENT], mode: "solo" },
    });
    if (room.userId !== userId || room.projectId || !room.agentIds.includes(AGENT)) {
      return Response.json({ error: "Channel room scope mismatch" }, { status: 403 });
    }
    const recent = await db.message.findMany({ where: { chatRoomId: roomId }, orderBy: { createdAt: "desc" }, take: 2 });
    const trace = new RequestTrace();
    const turn = beginSystemOne({
      surface: "runtime_chat", agentId: AGENT, request: body.text, trace, signal: request.signal,
      recentTurns: recent.reverse().map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    });
    // Telegram goes through Sentinel's Jev decision BEFORE Lisa starts.
    // Jev is a typed decision model; Lisa remains the conversational worker.
    const result = await turn.result;
    const plan = turn.mode === "off" ? null : planForTurn(turn, result, "runtime_chat", false);
    trace.mark("routing_complete");
    trace.mark("system2_start");
    const response = await routeRuntimeChat({
      agentId: AGENT, userId, roomId, userContent: body.text, mode: "persistent_agent_runtime",
    }, async runtimeId => {
      if (runtimeId !== runtime.id) throw new Error("Channel runtime mismatch");
      return runtime;
    });
    const observed = observeRuntimeStream(response, {
      onFirstText: () => { trace.mark("system2_first_token"); trace.mark("response_first_token"); },
      onComplete: async executed => {
        trace.mark("request_complete");
        await recordDecision({ surface: "runtime_chat", agentId: AGENT, userId, roomId,
          mode: turn.mode, result, plan, executedPath: "system2", system2Invoked: true, trace,
          interrupted: executed.aborted,
          system2: { model: executed.model, inputTokens: executed.inputTokens, outputTokens: executed.outputTokens, tools: executed.toolNames },
        });
      },
    });
    let text = "";
    let error = "";
    for (const line of (await observed.text()).split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "text") text += event.text;
      if (event.type === "error") error = event.error;
    }
    if (error || !text.trim()) throw new Error(error || "Lisa returned no response");
    const answer = { text, roomId, routing: { provider: result.provider, model: result.providerModel, outcome: result.outcome, mode: turn.mode } };
    await redisSet(messageKey, JSON.stringify(answer), 86400);
    return Response.json(answer);
  } catch (error) {
    console.error("[channel-ingress] turn failed", error);
    return Response.json({ error: "Sentinel could not complete this turn. Check the conversation in Sentinel before resubmitting." }, { status: 503 });
  } finally {
    await redisReleaseLease(roomKey, lease);
  }
}
