interface VoiceBridgeKeys {
  anthropicKey?: string;
  openaiKey?: string;
  openrouterKey?: string;
}

interface ApiRoom {
  id: string;
  agentIds: string[];
}

async function resolveMissionRoom(): Promise<ApiRoom> {
  const response = await fetch("/api/rooms", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 401 ? "Permission denied" : "Chat rooms are unavailable");
  const rooms = await response.json() as ApiRoom[];
  if (rooms[0]) return rooms[0];
  const created = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Mission Control", agentIds: ["hermes-lisa"] }),
  });
  if (!created.ok) throw new Error("Mission Control chat could not be created");
  return created.json() as Promise<ApiRoom>;
}

/** Sends a voice transcript through the existing Chat API and room model. */
export async function sendVoiceTranscript(text: string, keys: VoiceBridgeKeys = {}): Promise<string> {
  const room = await resolveMissionRoom();
  const agentId = room.agentIds[0] ?? "hermes-lisa";
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(keys.anthropicKey ? { "x-anthropic-key": keys.anthropicKey } : {}),
      ...(keys.openaiKey ? { "x-openai-key": keys.openaiKey } : {}),
      ...(keys.openrouterKey ? { "x-openrouter-key": keys.openrouterKey } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: text }],
      agentId,
      roomId: room.id,
      userContent: text,
    }),
  });
  if (!response.ok || !response.body) throw new Error(response.status === 401 ? "Permission denied" : "Chat engine unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const event = JSON.parse(raw) as { type?: string; text?: string; error?: string };
        if (event.type === "text" && event.text) answer += event.text;
        if (event.type === "error") throw new Error(event.error ?? "Chat engine error");
      } catch (reason) {
        if (reason instanceof SyntaxError) continue;
        throw reason;
      }
    }
  }
  return answer;
}
