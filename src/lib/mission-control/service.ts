import type { AttentionAction, AttentionItem, MissionControlData, MissionControlService } from "./types";

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

export class HttpMissionControlService implements MissionControlService {
  async load(signal?: AbortSignal): Promise<MissionControlData> {
    const response = await fetch("/api/mission-control", {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.json() as Promise<MissionControlData>;
  }

  async resolveAttention(item: AttentionItem, action: AttentionAction): Promise<{ ok: true }> {
    if (action !== "approve" && action !== "reject") {
      throw new Error(`Unsupported attention action: ${action}`);
    }

    const request = item.targetType === "approval"
      ? fetch(`/api/approvals/${encodeURIComponent(item.targetId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: action === "approve" ? "approved" : "rejected" }),
        })
      : item.targetType === "learning-candidate"
        ? fetch(`/api/neural/learning-candidates/${encodeURIComponent(item.targetId)}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: action }),
          })
        : null;

    if (!request) throw new Error("This item must be opened and resolved at its source.");
    const response = await request;
    if (!response.ok) throw new Error(await errorMessage(response));
    return { ok: true };
  }
}

export const missionControlService = new HttpMissionControlService();
