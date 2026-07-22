// Shared fixture helpers for Neural Engine DB integration tests.
// Requires a real DATABASE_URL (see README section this test suite adds).

import { db } from "@/lib/db";

let seq = 0;
/** Unique-enough id fragment per test run, per call. */
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function makeAgent(name = "Test Agent") {
  return db.agent.create({
    data: {
      name,
      role: "tester",
      avatar: "🤖",
      color: "#6366f1",
      model: "test-model",
      toolPermissions: [],
    },
  });
}

export async function makeUser(email?: string) {
  return db.user.create({ data: { email: email ?? `${uid("user")}@example.com` } });
}

export async function makeProject(userId: string, name = "Test Project") {
  return db.project.create({ data: { name, userId } });
}

export async function makeKnowledgeObject(overrides: Partial<{
  type: string;
  title: string;
  sourceType: string;
  sourceId: string;
  scope: string;
  projectId: string | null;
}> = {}) {
  return db.knowledgeObject.create({
    data: {
      type: overrides.type ?? "Note",
      title: overrides.title ?? "Test object",
      sourceType: overrides.sourceType ?? "test",
      sourceId: overrides.sourceId ?? uid("src"),
      scope: overrides.scope ?? "project",
      projectId: overrides.projectId ?? null,
    },
  });
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}
