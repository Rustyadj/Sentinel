/**
 * TypeSafe Jev over the System One API (`POST {base}/v1/systemone`), served
 * either by TypeSafe directly or by OpenRouter — the request and response
 * shapes are identical, only the base URL and key differ.
 *
 * Every question in a request is answered in parallel against the same state
 * in one call, so a whole decision bundle costs one round trip.
 *
 * Deliberately no retry: this sits on the request path under a strict timeout,
 * and a retried classifier is slower than simply taking today's path.
 */
import type {
  SystemOneAnswer,
  SystemOneProvider,
  SystemOneProviderRequest,
  SystemOneProviderResponse,
  SystemOneQuestion,
} from "../types";

export class SystemOneProviderError extends Error {
  constructor(message: string, readonly kind: "http" | "malformed", readonly status?: number) {
    super(message);
    this.name = "SystemOneProviderError";
  }
}

interface JevOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

const isProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

function probabilityMap(value: unknown, keys: string[]): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const map = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of keys) {
    // A missing option is read as zero mass rather than rejecting the answer;
    // an unexpected or out-of-range value is not.
    const p = map[key] ?? 0;
    if (!isProbability(p)) return null;
    out[key] = p;
  }
  return out;
}

/** Validates one answer against the question that was asked. Null = malformed. */
export function parseJevAnswer(question: SystemOneQuestion, raw: unknown): SystemOneAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (answer.type !== question.type) return null;

  if (question.type === "noul") {
    return isProbability(answer.noul) ? { type: "noul", noul: answer.noul } : null;
  }
  if (question.type === "choice") {
    const options = Object.keys(question.criteria);
    if (typeof answer.choice !== "string" || !options.includes(answer.choice)) return null;
    if (!isProbability(answer.confidence)) return null;
    const probabilities = probabilityMap(answer.probabilities, options);
    if (!probabilities) return null;
    return { type: "choice", choice: answer.choice, probabilities, confidence: answer.confidence };
  }
  const levels = question.criteria.length;
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > levels - 1) return null;
  if (!isProbability(answer.confidence)) return null;
  const probabilities = probabilityMap(answer.probabilities, question.criteria.map((_, i) => String(i)));
  if (!probabilities) return null;
  return { type: "score", score: answer.score, probabilities, confidence: answer.confidence, levels };
}

export class JevProvider implements SystemOneProvider {
  readonly name = "jev";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: JevOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async evaluate(request: SystemOneProviderRequest, signal: AbortSignal): Promise<SystemOneProviderResponse> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Sentinel OS",
      },
      body: JSON.stringify({ model: this.options.model, state: request.state, questions: request.questions }),
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      // 401/422 are configuration bugs; 429/529 are load. Both mean "not now".
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new SystemOneProviderError(`System One API ${response.status}: ${detail}`, "http", response.status);
    }

    const body = (await response.json().catch(() => null)) as {
      model?: unknown;
      answers?: Record<string, unknown>;
      usage?: { input_tokens?: unknown; cost?: unknown };
    } | null;
    if (!body?.answers || typeof body.answers !== "object") {
      throw new SystemOneProviderError("System One response has no answers", "malformed");
    }

    const answers: Record<string, SystemOneAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const parsed = parseJevAnswer(question, body.answers[id]);
      // All-or-nothing: routing on a partial bundle would mean acting on the
      // questions that happened to parse while silently guessing the rest.
      if (!parsed) throw new SystemOneProviderError(`Malformed answer for "${id}"`, "malformed");
      answers[id] = parsed;
    }

    return {
      answers,
      model: typeof body.model === "string" ? body.model : this.options.model,
      inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
      costUsd: typeof body.usage?.cost === "number" && Number.isFinite(body.usage.cost) ? body.usage.cost : null,
    };
  }
}
