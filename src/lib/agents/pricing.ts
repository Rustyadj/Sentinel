export interface ReportedTokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWrite5mInputTokens: number;
  cacheWrite1hInputTokens: number;
}

interface ModelTokenPrices {
  input: number;
  cachedInput: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
}

/**
 * USD per million tokens, verified 2026-09-07 against the providers' public
 * rate cards. Exact runtime model ids only: an unlisted model has unknown cost.
 *
 * OpenAI: https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing
 * Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 */
const MODEL_TOKEN_PRICES: Readonly<Record<string, ModelTokenPrices>> = {
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4, output: 10 },
  "claude-opus-5": { input: 5, cachedInput: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, output: 25 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, cacheWrite5m: 5, cacheWrite1h: 8, output: 20 },
  "gpt-6-astra": { input: 10, cachedInput: 1, cacheWrite5m: 12.5, cacheWrite1h: 20, output: 50 },
};

export function isReportedTokenUsage(value: unknown): value is ReportedTokenUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWrite5mInputTokens", "cacheWrite1hInputTokens"]
    .every((key) => typeof usage[key] === "number" && Number.isFinite(usage[key]) && usage[key] >= 0);
}

export function calculateModelCost(model: string, usage: ReportedTokenUsage | undefined): number | null {
  const prices = MODEL_TOKEN_PRICES[model];
  if (!prices || !isReportedTokenUsage(usage)) return null;
  return (
    usage.inputTokens * prices.input
    + usage.cachedInputTokens * prices.cachedInput
    + usage.cacheWrite5mInputTokens * prices.cacheWrite5m
    + usage.cacheWrite1hInputTokens * prices.cacheWrite1h
    + usage.outputTokens * prices.output
  ) / 1_000_000;
}
