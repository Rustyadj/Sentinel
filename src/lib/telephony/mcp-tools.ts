import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendAgentMessage } from "./calls/messaging";
import { placeOutboundCall } from "./calls/service";
import { isTelnyxConfigured } from "./telnyx/config";

interface ToolHelpers {
  userId: string;
  requireScope: (scope: "sentinel.tasks.write" | "sentinel.memory.read" | "sentinel.read") => void;
  toolResult: (data: Record<string, unknown>, message: string) => { structuredContent: Record<string, unknown>; content: { type: "text"; text: string }[] };
}

const MAX_TRANSCRIPT_TURNS = 80;

/**
 * Phone tools for the Hermes agents. Registered only when Telnyx is
 * configured, so a deployment without a phone line does not advertise tools
 * that cannot work. Every call is checked again server-side: destination
 * policy, rate limits, duplicate suppression and per-user ownership live in
 * the service layer, not in the tool description.
 */
export function registerTelephonyTools(server: McpServer, { userId, requireScope, toolResult }: ToolHelpers): void {
  if (!isTelnyxConfigured()) return;

  server.registerTool("sentinel.place_call", {
    title: "Place a phone call",
    description: "Immediately place an outbound phone call as a Sentinel voice agent (hermes-lisa or hermes-nathan2). The agent itself speaks on the call with its own identity, memory and tools. `target` is a phone number (E.164) or the name of a saved contact. `purpose` states what the call must accomplish. Returns at once with a call id; the outcome is recorded afterwards (use sentinel.call_history). Do not ask the user to confirm a call they have already explicitly requested.",
    inputSchema: z.object({
      agent: z.string().min(1).max(60),
      target: z.string().min(1).max(120),
      purpose: z.string().min(1).max(1_000),
      idempotencyKey: z.string().min(8).max(120).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    requireScope("sentinel.tasks.write");
    const { call, replayed } = await placeOutboundCall({ userId, ...input });
    return toolResult(
      { callId: call.id, status: call.status, to: call.toNumber, contact: call.contactName, replayed },
      replayed ? `Call ${call.id} was already placed (${call.status}).` : `Calling ${call.contactName ?? call.toNumber} now (call ${call.id}).`,
    );
  });

  server.registerTool("sentinel.send_sms", {
    title: "Send a text message",
    description: "Send an SMS (or MMS with https attachment URLs) as a Sentinel voice agent. `target` is a phone number (E.164) or a saved contact name.",
    inputSchema: z.object({
      agent: z.string().min(1).max(60),
      target: z.string().min(1).max(120),
      text: z.string().max(1_500).default(""),
      mediaUrls: z.array(z.string().url()).max(10).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    requireScope("sentinel.tasks.write");
    const message = await sendAgentMessage({ userId, ...input });
    return toolResult({ messageId: message.id, to: message.toNumber, status: message.status }, `Message sent to ${message.toNumber}.`);
  });

  server.registerTool("sentinel.call_history", {
    title: "Search phone call history",
    description: "Look up this user's past phone calls, with summaries and (optionally) transcripts. Use to answer questions such as what someone said on a call. Filter by contact name or number, by a text query over summaries and transcripts, and by recency. Returns only what was recorded; never infer details that are not present.",
    inputSchema: z.object({
      contact: z.string().max(120).optional(),
      query: z.string().max(200).optional(),
      sinceHours: z.number().int().min(1).max(24 * 365).optional(),
      includeTranscript: z.boolean().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ contact, query, sinceHours, includeTranscript, limit = 5 }) => {
    requireScope("sentinel.memory.read");
    const calls = await db.phoneCall.findMany({
      where: {
        userId,
        trust: "trusted",
        ...(sinceHours ? { startedAt: { gt: new Date(Date.now() - sinceHours * 3_600_000) } } : {}),
        ...(contact ? { OR: [{ contactName: { contains: contact, mode: "insensitive" } }, { toNumber: { contains: contact } }, { fromNumber: { contains: contact } }] } : {}),
        ...(query ? { OR: [{ summary: { contains: query, mode: "insensitive" } }, { turns: { some: { text: { contains: query, mode: "insensitive" } } } }] } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: includeTranscript ? { turns: { orderBy: { offsetMs: "asc" }, take: MAX_TRANSCRIPT_TURNS } } : undefined,
    });
    const results = calls.map((c) => ({
      id: c.id, agentId: c.agentId, direction: c.direction, status: c.status, contact: c.contactName,
      number: c.direction === "outbound" ? c.toNumber : c.fromNumber, startedAt: c.startedAt, durationSeconds: c.durationSeconds,
      purpose: c.purpose, summary: c.summary,
      ...("turns" in c ? { transcript: (c.turns as { role: string; text: string }[]).map((t) => ({ role: t.role, text: t.text })) } : {}),
    }));
    return toolResult({ calls: results }, results.length === 0 ? "No matching calls were recorded." : `Found ${results.length} recorded call(s).`);
  });

  server.registerTool("sentinel.call_status", {
    title: "Get phone call status",
    description: "Return the current status, outcome and summary of one phone call by id.",
    inputSchema: z.object({ callId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ callId }) => {
    requireScope("sentinel.read");
    const call = await db.phoneCall.findFirst({ where: { id: callId, userId } });
    if (!call) throw new Error("Call not found.");
    return toolResult(
      { id: call.id, status: call.status, endReason: call.endReason, durationSeconds: call.durationSeconds, summary: call.summary },
      `Call ${call.id} is ${call.status}.`,
    );
  });
}
