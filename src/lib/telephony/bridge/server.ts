import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { verifyMediaToken } from "../calls/media-token";
import * as telnyx from "../telnyx/client";
import { loadTelnyxConfig, requireCallingConfig, type TelnyxConfig } from "../telnyx/config";
import { runAgentTurn } from "./app-client";
import { CallBridge } from "./call-bridge";
import { finalizeCall, markCallActive, recordTurn } from "./finalize";
import { ensurePhoneRoom } from "./phone-room";

const MEDIA_PATHS = new Set(["/media", "/telephony/media"]);

export interface BridgeServerOptions {
  port: number;
  openaiApiKey: string;
  config?: TelnyxConfig;
}

/**
 * The media-bridge process. Next.js route handlers cannot terminate a
 * WebSocket, so Telnyx's media stream lands here, on its own port behind the
 * reverse proxy. Authentication is the HMAC token in the stream URL.
 */
export function startBridgeServer(options: BridgeServerOptions): Server {
  const config = options.config ?? loadTelnyxConfig();
  requireCallingConfig(config);
  const bridges = new Map<string, CallBridge>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });

  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, activeCalls: bridges.size }));
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://bridge.local");
    const callId = MEDIA_PATHS.has(url.pathname) ? verifyMediaToken(config.mediaTokenSecret, url.searchParams.get("t")) : null;
    if (!callId || bridges.has(callId)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => void attach(callId, ws));
  });

  async function attach(callId: string, ws: import("ws").WebSocket): Promise<void> {
    try {
      const call = await db.phoneCall.findUnique({ where: { id: callId } });
      const voice = call ? resolveAgentVoiceConfig(call.agentId) : null;
      if (!call || !voice || !["queued", "ringing", "active"].includes(call.status)) {
        ws.close(1008, "call not available");
        return;
      }
      if (bridges.size >= config.maxConcurrentCalls) {
        ws.close(1013, "busy");
        return;
      }

      const [owner, roomId] = await Promise.all([
        db.user.findUnique({ where: { id: call.userId }, select: { name: true, email: true } }),
        call.trust === "trusted" ? ensurePhoneRoom(call.userId, call.agentId) : Promise.resolve(null),
      ]);
      if (roomId) await db.phoneCall.update({ where: { id: call.id }, data: { roomId } });
      await markCallActive(call.id);

      // Turn writes are fire-and-forget during the call; hang-up waits for them so the summary sees the whole transcript.
      const persisting = new Set<Promise<unknown>>();
      const bridge = new CallBridge({
        callId: call.id,
        voice,
        context: {
          direction: call.direction === "outbound" ? "outbound" : "inbound",
          trust: call.trust === "trusted" ? "trusted" : "screened",
          ownerName: owner?.name ?? owner?.email.split("@")[0] ?? "the owner",
          contactName: call.contactName,
          purpose: call.purpose,
        },
        telnyx: ws,
        live: { apiKey: options.openaiApiKey, userId: call.userId },
        maxCallSeconds: config.maxCallSeconds,
        runTurn: (request, signal) => runAgentTurn(call.id, request, signal),
        onTurn: (turn) => {
          const write = recordTurn(call.id, turn).catch((e) => logger.warn("telephony.turn_persist_failed", { callId: call.id, error: String(e) }));
          persisting.add(write);
          void write.finally(() => persisting.delete(write));
        },
        hangup: async () => {
          if (call.telnyxCallControlId) await telnyx.hangupCall(config, call.telnyxCallControlId);
        },
        onFinished: (result) => {
          bridges.delete(call.id);
          void Promise.allSettled([...persisting]).then(() => finalizeCall({ callId: call.id, ...result })).catch((e) => logger.error("telephony.finalize_failed", { callId: call.id, error: String(e) }));
        },
      });
      bridges.set(call.id, bridge);
      bridge.start();
      logger.info("telephony.bridge_started", { callId: call.id, agentId: call.agentId, direction: call.direction, trust: call.trust });
    } catch (error) {
      logger.error("telephony.attach_failed", { callId, error: String(error) });
      ws.close(1011, "internal error");
    }
  }

  server.listen(options.port);

  // Graceful shutdown: end every live session cleanly so usage is confirmed and transcripts persist.
  const shutdown = async () => {
    await Promise.allSettled([...bridges.values()].map((b) => b.finish("bridge_shutdown", true)));
    server.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  return server;
}
