import { Buffer } from "node:buffer";
import { analysisFormats, audioFormats, getMediaProvider, maxMediaBytes } from "@/lib/workforce/media";
import { requireWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";

const noStore = { "Cache-Control": "no-store" };

async function readLimitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) return Buffer.alloc(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId");
  const action = params.get("action");
  if (!workspaceId || workspaceId.length > 100 || (action !== "transcribe" && action !== "synthesize" && action !== "analyze")) {
    return Response.json({ error: "A workspace and a valid media action are required." }, { status: 400, headers: noStore });
  }
  try {
    await requireWorkspacePermission(workspaceId, "agents.runtime.execute");
    const provider = getMediaProvider();
    if (!provider) return Response.json({ error: "Configure an OpenAI API key to use workforce media." }, { status: 503, headers: noStore });

    if (action !== "synthesize") {
      const mime = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      const supported = action === "transcribe" ? Object.hasOwn(audioFormats, mime) : analysisFormats.has(mime);
      if (!supported) return Response.json({ error: "Unsupported file format for this operation." }, { status: 415, headers: noStore });
      const body = await readLimitedBody(request, maxMediaBytes);
      if (!body) return Response.json({ error: "Files must be 10 MB or smaller." }, { status: 413, headers: noStore });
      if (!body.length) return Response.json({ error: "Select a nonempty file." }, { status: 400, headers: noStore });
      if (action === "analyze") {
        const result = await provider.analyze({ bytes: body, mimeType: mime }, request.signal);
        return Response.json({ provider: provider.id, ...result }, { headers: noStore });
      }

      const audio = new File([new Uint8Array(body)], `audio.${audioFormats[mime]}`, { type: mime });
      const result = await provider.transcribe(audio, request.signal);
      return Response.json({ provider: provider.id, ...result }, { headers: noStore });
    }

    const body = await readLimitedBody(request, 16_384);
    const text = body?.toString("utf8").trim();
    if (!text || text.length > 4096) return Response.json({ error: "Enter 1–4096 characters to synthesize." }, { status: 400, headers: noStore });
    const result = await provider.synthesize(text, request.signal);
    return new Response(result.bytes, {
      headers: { ...noStore, "Content-Type": result.mimeType, "X-Audio-Provider": provider.id, "X-Audio-Model": result.model, "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    return Response.json({ error: "The media provider could not complete this request." }, { status: 502, headers: noStore });
  }
}
