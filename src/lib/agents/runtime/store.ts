import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { redactPayload } from "@/lib/learning/redaction";
import type {
  AgentRuntimeKind,
  AgentSession,
  AgentSessionStatus,
  RuntimeEvent,
  RuntimeEventType,
  SessionQuery,
  StartSessionInput,
} from "./types";

type SessionRow = Awaited<ReturnType<typeof db.agentSession.findUniqueOrThrow>>;

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function toAgentSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    runtime: row.runtime as AgentRuntimeKind,
    runtimeInstanceId: row.runtimeInstanceId,
    ...(row.externalSessionId ? { externalSessionId: row.externalSessionId } : {}),
    agentId: row.agentId,
    userId: row.userId,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.workingDirectory ? { workingDirectory: row.workingDirectory } : {}),
    status: row.status as AgentSessionStatus,
    startedAt: row.startedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.exitCode !== null ? { exitCode: row.exitCode } : {}),
    ...(row.cancelledAt ? { cancelledAt: row.cancelledAt.toISOString() } : {}),
    metadata: jsonRecord(row.metadata),
    ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
  };
}

export interface RuntimeSessionStore {
  create(input: StartSessionInput, runtime: AgentRuntimeKind, agentId: string, workingDirectory?: string, externalSessionId?: string): Promise<AgentSession>;
  get(id: string): Promise<AgentSession | null>;
  list(query: SessionQuery): Promise<AgentSession[]>;
  update(id: string, data: Partial<Pick<AgentSession, "status" | "externalSessionId" | "exitCode">> & { completedAt?: Date; cancelledAt?: Date; metadata?: Record<string, unknown> }): Promise<AgentSession>;
  append(sessionId: string, type: RuntimeEventType, data?: Record<string, unknown>): Promise<RuntimeEvent>;
  logs(sessionId: string, since?: string, limit?: number): Promise<{ events: RuntimeEvent[]; hasMore: boolean }>;
}

export class PrismaRuntimeSessionStore implements RuntimeSessionStore {
  async create(input: StartSessionInput, runtime: AgentRuntimeKind, agentId: string, workingDirectory?: string, externalSessionId?: string) {
    return toAgentSession(await db.agentSession.create({
      data: {
        runtime,
        runtimeInstanceId: input.runtimeId,
        externalSessionId,
        agentId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workingDirectory,
        status: "ready",
        metadata: {} as Prisma.InputJsonValue,
      },
    }));
  }

  async get(id: string) {
    const row = await db.agentSession.findUnique({ where: { id } });
    return row ? toAgentSession(row) : null;
  }

  async list(query: SessionQuery) {
    const rows = await db.agentSession.findMany({
      where: {
        ...(query.runtimeId ? { runtimeInstanceId: query.runtimeId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { lastActivityAt: "desc" },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    });
    return rows.map(toAgentSession);
  }

  async update(id: string, data: Partial<Pick<AgentSession, "status" | "externalSessionId" | "exitCode">> & { completedAt?: Date; cancelledAt?: Date; metadata?: Record<string, unknown> }) {
    return toAgentSession(await db.agentSession.update({
      where: { id },
      data: {
        ...data,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
        lastActivityAt: new Date(),
      },
    }));
  }

  async append(sessionId: string, type: RuntimeEventType, data: Record<string, unknown> = {}) {
    // Worker stdout/stderr lands here verbatim from the CLI/runtime adapters
    // (cli-adapter.ts, hermes.ts, openclaw.ts) — this is the single choke
    // point all of them funnel through, so it's also the one place that can
    // catch a coding worker `cat`-ing a real credential before it's
    // persisted, streamed back to the caller (the returned RuntimeEvent
    // below is what chat-routing.ts accumulates into chat transcripts), or
    // later picked up as Learning Core evidence. Redact-then-persist, not
    // block: this is executed output, not a config value a human is about
    // to submit (that's sensitive-config.ts's job).
    const { payload: sanitizedData } = redactPayload(data);
    const event = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runtime-event:${sessionId}`}))`;
      const aggregate = await tx.agentRuntimeEvent.aggregate({ where: { sessionId }, _max: { sequence: true } });
      const sequence = (aggregate._max.sequence ?? 0) + 1;
      const row = await tx.agentRuntimeEvent.create({
        data: { sessionId, sequence, type, payload: sanitizedData as Prisma.InputJsonValue },
      });
      await tx.agentSession.update({ where: { id: sessionId }, data: { lastActivityAt: row.occurredAt } });
      return {
        type: row.type as RuntimeEventType,
        sessionId,
        sequence,
        timestamp: row.occurredAt.toISOString(),
        data: jsonRecord(row.payload),
      } as RuntimeEvent;
    });
    const eventValue = sanitizedData.event && typeof sanitizedData.event === "object" ? sanitizedData.event as Record<string, unknown> : sanitizedData;
    const failedTool = type === "tool_completed" && (eventValue.is_error === true || eventValue.success === false || eventValue.ok === false || eventValue.error);
    const exitCode = sanitizedData.exitCode ?? eventValue.exitCode;
    const failedCommand = type === "command_completed" && typeof exitCode === "number" && exitCode !== 0;
    const testCommand = /(?:\btest\b|vitest|jest|pytest|playwright|cargo test|go test)/i.test(String(sanitizedData.command ?? eventValue.command ?? ""));
    if (failedTool || failedCommand || type === "error") {
      const session = await this.get(sessionId);
      if (session) {
        const { recordProductionFailure } = await import("@/lib/learning/production-failures");
        const signal = failedTool ? "failed_tool_call" : failedCommand ? (testCommand ? "failing_test" : "failed_tool_call") : session.parentSessionId ? "delegation_failure" : null;
        if (signal) await recordProductionFailure(signal, { sourceId: sessionId, workspaceId: session.workspaceId, userId: session.userId, context: sanitizedData }).catch(() => undefined);
      }
    }
    return event;
  }

  async logs(sessionId: string, since?: string, limit = 200) {
    const bounded = Math.min(Math.max(limit, 1), 500);
    const sequenceCursor = since && /^\d+$/.test(since) ? Number.parseInt(since, 10) : undefined;
    const rows = await db.agentRuntimeEvent.findMany({
      where: {
        sessionId,
        ...(sequenceCursor !== undefined
          ? { sequence: { gt: sequenceCursor } }
          : since ? { occurredAt: { gt: new Date(since) } } : {}),
      },
      orderBy: { sequence: "asc" },
      take: bounded + 1,
    });
    return {
      hasMore: rows.length > bounded,
      events: rows.slice(0, bounded).map((row) => ({
        type: row.type as RuntimeEventType,
        sessionId,
        sequence: row.sequence,
        timestamp: row.occurredAt.toISOString(),
        data: jsonRecord(row.payload),
      }) as RuntimeEvent),
    };
  }
}

export const runtimeSessionStore = new PrismaRuntimeSessionStore();
