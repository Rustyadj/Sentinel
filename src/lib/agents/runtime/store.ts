import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
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
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runtime-event:${sessionId}`}))`;
      const aggregate = await tx.agentRuntimeEvent.aggregate({ where: { sessionId }, _max: { sequence: true } });
      const sequence = (aggregate._max.sequence ?? 0) + 1;
      const row = await tx.agentRuntimeEvent.create({
        data: { sessionId, sequence, type, payload: data as Prisma.InputJsonValue },
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
  }

  async logs(sessionId: string, since?: string, limit = 200) {
    const bounded = Math.min(Math.max(limit, 1), 500);
    const rows = await db.agentRuntimeEvent.findMany({
      where: { sessionId, ...(since ? { occurredAt: { gt: new Date(since) } } : {}) },
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
