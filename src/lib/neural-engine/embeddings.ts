// Sentinel — embedding provider seam.
//
// `memories.embedding` has been declared `vector(1536)` since the initial
// migration and nothing ever wrote to it. The first version of this file
// treated that column width as a hard contract and rejected any model that
// did not emit exactly 1536 dimensions — which quietly made a column type the
// thing that chose Sentinel's embedding provider, ruling out voyage-3-lite
// (512) and voyage-3 (1024) on a detail that has nothing to do with retrieval
// quality.
//
// Vectors now live in `memory_embeddings`, one row per (memory, provider,
// model, version), with a vector column per dimension family. So:
//
//   1. Dimension is still never coerced. Padding or truncating a vector
//      destroys cosine geometry, and a silently wrong distance is worse than
//      no distance. But a model that does not fit one column is now stored in
//      the column that does fit, rather than rejected.
//   2. A memory may carry several embeddings at once. That is what makes
//      "Voyage or OpenAI?" a measurable question instead of an opinion.
//   3. Absence is a supported state. When no provider is configured or one is
//      configured but unreachable, `embed()` returns null and callers fall
//      back to lexical scoring. Retrieval must never fail because an
//      embedding API is down.
//   4. Provenance travels with the vector: provider, model, dimensions,
//      version and creation time, so incomparable spaces can never be
//      silently mixed and a re-embedding is distinguishable from the run it
//      replaced.
//
// Provider choice is settled by bench/memory (retrieval quality, latency,
// cost), never by which number happens to be in a column type.

import { logger } from "@/lib/logger";

/** Dimension families `memory_embeddings` has a column for. A model whose
 *  output is not one of these cannot be stored without a migration adding the
 *  matching column — which is a deliberate, reviewable decision rather than a
 *  silent rejection. */
export const SUPPORTED_DIMENSIONS = [512, 1024, 1536, 3072] as const;
export type SupportedDimension = (typeof SUPPORTED_DIMENSIONS)[number];

/** Legacy width of the unused `memories.embedding` column. Retained only so
 *  older callers keep compiling; it no longer constrains provider choice. */
export const LEGACY_EMBEDDING_DIMENSIONS = 1536;

export function isSupportedDimension(value: number): value is SupportedDimension {
  return (SUPPORTED_DIMENSIONS as readonly number[]).includes(value);
}

/** The `memory_embeddings` column a vector of this width belongs in. */
export function vectorColumnFor(dimensions: number): string {
  if (!isSupportedDimension(dimensions)) {
    throw new UnsupportedDimensionError(dimensions);
  }
  return `vector${dimensions}`;
}

export type EmbeddingProviderName = "openai" | "voyage" | "none";

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  model: string;
  apiKey: string | null;
}

/**
 * Known models and the dimension they actually emit. A model is only usable if
 * its dimension equals EMBEDDING_DIMENSIONS, because that is the column width.
 *
 * voyage-3-lite emits 512 and voyage-3 emits 1024 — neither fits the current
 * column. They are listed so the failure is an explicit, explained rejection
 * at startup rather than a confusing runtime error, and so that adding a
 * `vector(512)` column later is a documented decision rather than a surprise.
 */
export const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "voyage-3-lite": 512,
  "voyage-3": 1024,
  "voyage-3-large": 1024,
  "voyage-code-3": 1024,
};

export function readEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const provider = (env.SENTINEL_EMBEDDING_PROVIDER ?? "none").toLowerCase() as EmbeddingProviderName;
  if (provider === "openai") {
    return {
      provider,
      model: env.SENTINEL_EMBEDDING_MODEL ?? "text-embedding-3-small",
      apiKey: env.OPENAI_API_KEY ?? null,
    };
  }
  if (provider === "voyage") {
    return {
      provider,
      model: env.SENTINEL_EMBEDDING_MODEL ?? "voyage-3-lite",
      apiKey: env.VOYAGE_API_KEY ?? null,
    };
  }
  return { provider: "none", model: "none", apiKey: null };
}

export class EmbeddingDimensionError extends Error {
  constructor(model: string, got: number, expected: number) {
    super(
      `Embedding model "${model}" returned ${got} dimensions but ${expected} were expected. ` +
        `Vectors are never padded or truncated to fit — that would corrupt cosine distance.`,
    );
    this.name = "EmbeddingDimensionError";
  }
}

export class UnsupportedDimensionError extends Error {
  constructor(dimensions: number) {
    super(
      `No vector column exists for ${dimensions}-dimensional embeddings. ` +
        `memory_embeddings has columns for ${SUPPORTED_DIMENSIONS.join(", ")}. ` +
        `Add a migration for a vector(${dimensions}) column to support this model.`,
    );
    this.name = "UnsupportedDimensionError";
  }
}

async function postJson(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Both providers return OpenAI-shaped `{ data: [{ embedding, index }] }`. */
function parseEmbeddingResponse(payload: unknown, expected: number): number[][] {
  const data = (payload as { data?: Array<{ embedding?: unknown; index?: number }> })?.data;
  if (!Array.isArray(data)) throw new Error("Embedding response had no `data` array.");
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((row) => {
    const vector = row.embedding;
    if (!Array.isArray(vector) || vector.some((value) => typeof value !== "number")) {
      throw new Error("Embedding response contained a non-numeric vector.");
    }
    if (vector.length !== expected) throw new EmbeddingDimensionError("(response)", vector.length, expected);
    return vector as number[];
  });
}

const REQUEST_TIMEOUT_MS = 20_000;

function createProvider(config: EmbeddingConfig): EmbeddingProvider | null {
  if (config.provider === "none" || !config.apiKey) return null;

  const dimensions = MODEL_DIMENSIONS[config.model];
  if (dimensions === undefined) {
    logger.warn("embeddings: unknown model, refusing to guess its dimension", { model: config.model });
    return null;
  }
  if (!isSupportedDimension(dimensions)) {
    // Not "this model is wrong" — "this deployment has nowhere to put it yet".
    logger.warn("embeddings: no vector column for this model's dimension", {
      model: config.model,
      modelDimensions: dimensions,
      supported: SUPPORTED_DIMENSIONS,
    });
    return null;
  }

  const apiKey = config.apiKey;
  if (config.provider === "openai") {
    return {
      name: "openai",
      model: config.model,
      dimensions,
      async embed(texts) {
        const payload = await postJson(
          "https://api.openai.com/v1/embeddings",
          apiKey,
          { input: texts, model: config.model },
          REQUEST_TIMEOUT_MS,
        );
        return parseEmbeddingResponse(payload, dimensions);
      },
    };
  }

  return {
    name: "voyage",
    model: config.model,
    dimensions,
    async embed(texts) {
      const payload = await postJson(
        "https://api.voyageai.com/v1/embeddings",
        apiKey,
        { input: texts, model: config.model },
        REQUEST_TIMEOUT_MS,
      );
      return parseEmbeddingResponse(payload, dimensions);
    },
  };
}

let cached: { provider: EmbeddingProvider | null; key: string } | null = null;

export function getEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const config = readEmbeddingConfig(env);
  const key = `${config.provider}:${config.model}:${config.apiKey ? "keyed" : "unkeyed"}`;
  if (cached?.key === key) return cached.provider;
  const provider = createProvider(config);
  cached = { provider, key };
  return provider;
}

/** Test seam — clears the memoised provider so env changes take effect. */
export function resetEmbeddingProvider(): void {
  cached = null;
}

/** Stable identifier for the space a stored vector lives in. */
export function embeddingModelId(provider: EmbeddingProvider | null): string | null {
  return provider ? `${provider.name}:${provider.model}` : null;
}

export interface EmbedResult {
  vectors: number[][];
  modelId: string;
}

const MAX_BATCH = 96;

/**
 * Embed a batch of texts, or return null when embeddings are unavailable.
 *
 * Null is the honest answer for "no provider configured", "provider
 * unreachable" and "provider rejected the request" alike: in every one of
 * those cases the caller has no vector and must fall back to lexical scoring.
 * It deliberately does not throw, because this sits behind memory writes and
 * the retrieval path, neither of which may fail on an embedding outage.
 */
export async function embed(texts: string[]): Promise<EmbedResult | null> {
  const provider = getEmbeddingProvider();
  if (!provider) return null;

  const cleaned = texts.map((text) => text.replace(/\s+/g, " ").trim()).filter((text) => text.length > 0);
  if (cleaned.length !== texts.length) return null; // never silently misalign inputs to outputs
  if (cleaned.length === 0) return { vectors: [], modelId: embeddingModelId(provider)! };

  try {
    const vectors: number[][] = [];
    for (let offset = 0; offset < cleaned.length; offset += MAX_BATCH) {
      vectors.push(...(await provider.embed(cleaned.slice(offset, offset + MAX_BATCH))));
    }
    return { vectors, modelId: embeddingModelId(provider)! };
  } catch (error) {
    logger.warn("embeddings: provider call failed, falling back to lexical scoring", {
      provider: provider.name,
      model: provider.model,
      error: String(error),
    });
    return null;
  }
}

/** Embed exactly one text. Same null contract as `embed`. */
export async function embedOne(text: string): Promise<number[] | null> {
  const result = await embed([text]);
  return result?.vectors[0] ?? null;
}

/** Cosine similarity for two equal-length vectors, clamped to [0,1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.min(1, Math.max(0, (similarity + 1) / 2));
}
