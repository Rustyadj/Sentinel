import { describe, expect, it } from "vitest";
import { looksLikeAuthenticationRequired, looksLikeModelUnavailable } from "@/lib/agents/model-policy";

describe("looksLikeAuthenticationRequired", () => {
  it("recognises the production Claude Code failure", () => {
    expect(looksLikeAuthenticationRequired(
      "Failed to authenticate: OAuth session expired and could not be refreshed"
    )).toBe(true);
  });

  it("recognises the other common re-authentication signals", () => {
    for (const line of [
      "Error: not authenticated",
      "invalid_api_key",
      "401 Unauthorized",
      "credentials expired",
      "Please run `claude login` to continue",
    ]) expect(looksLikeAuthenticationRequired(line), line).toBe(true);
  });

  it("does not claim ordinary task failures are auth problems", () => {
    for (const line of [
      "Error: permission denied writing to /repo/file.ts",
      "network timeout after 30s",
      "TypeError: cannot read property 'x' of undefined",
    ]) expect(looksLikeAuthenticationRequired(line), line).toBe(false);
  });

  // The two classifiers must stay disjoint: the adapter prefers
  // MODEL_UNAVAILABLE, so an auth error misread as a model error would tell the
  // operator to change model instead of to re-authenticate.
  it("does not collide with the model-unavailable classifier", () => {
    const auth = "Failed to authenticate: OAuth session expired and could not be refreshed";
    expect(looksLikeModelUnavailable(auth)).toBe(false);
    expect(looksLikeAuthenticationRequired("Error: model 'claude-opus-5' not found")).toBe(false);
  });
});
