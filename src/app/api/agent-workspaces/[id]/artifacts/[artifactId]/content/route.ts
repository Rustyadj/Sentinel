import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readArtifact } from "@/lib/agent-workspaces/artifacts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const { workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const { artifact, buffer, checksum } = await readArtifact(workspace, artifactId);
    const disposition = new URL(request.url).searchParams.get("download") === "true" ? "attachment" : "inline";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `${disposition}; filename="${artifact.name.replace(/["\\]/g, "")}"`,
        "X-Artifact-Checksum": checksum,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
