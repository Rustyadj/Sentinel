import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncWorkflowToGraph } from "@/lib/knowledge/workflowgraph";

export async function GET() {
  const workflows = await db.workflow.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(workflows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const workflow = await db.workflow.create({
    data: {
      name: body.name ?? "New Workflow",
      description: body.description ?? "",
      nodes: body.nodes ?? [],
      edges: body.edges ?? [],
      status: "draft",
    },
  });
  await syncWorkflowToGraph(workflow);
  return NextResponse.json(workflow);
}
