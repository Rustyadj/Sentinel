import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listEvalSuites, listEvalCases, compileEvalCase } from "@/lib/learning/eval-compiler";
import { learningAccessErrorResponse, requireLearningWorkspaceAccess } from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const suiteId = searchParams.get("suiteId") ?? undefined;
  const [suites, cases] = await Promise.all([
    listEvalSuites({ category: searchParams.get("category") ?? undefined, workspaceId: searchParams.get("workspaceId") ?? undefined }),
    suiteId ? listEvalCases({ suiteId }) : Promise.resolve([]),
  ]);
  return NextResponse.json({ suites, cases });
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.source || !body.failureType || !body.expectedBehavior || !body.rawContext) {
    return NextResponse.json({ error: "source, failureType, expectedBehavior, and rawContext are required" }, { status: 400 });
  }
  try {
    if (body.workspaceId) await requireLearningWorkspaceAccess(user.id, body.workspaceId, "workspace.update");
    const result = await compileEvalCase({ ...body, userId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
