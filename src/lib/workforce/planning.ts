import OpenAI from "openai";
import { z } from "zod";
import { workforcePlanSchema } from "./plan";

export function planningAvailable() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export class WorkforcePlanningError extends Error {}

export async function planWorkforce(instruction: string, organization: string, requestSignal?: AbortSignal) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new WorkforcePlanningError("Connect OpenRouter to generate a workforce plan, or start from a template.");
  const client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1", timeout: 35_000, maxRetries: 0 });
  const result = await client.chat.completions.create({
    model: process.env.WORKFORCE_PLANNING_MODEL?.trim() || "deepseek/deepseek-v4.1-flash",
    messages: [
      {
        role: "system",
        content: [
          "Design a workforce draft for the selected Sentinel organization.",
          "Respect the requested team size. Assign distinct names, responsibilities, personalities and measurable objectives.",
          "Use a specialist's plan key for reportsTo or null for a team lead. Keep reporting relationships acyclic.",
          "List required capabilities by name and use cadence once, daily, weekly, or monthly.",
          "Return a JSON object matching this schema. Capability names represent requirements only.",
          JSON.stringify(z.toJSONSchema(workforcePlanSchema)),
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify({ organization, instruction }) },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 7_500,
  }, { signal: requestSignal }).catch((error: unknown) => {
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    throw new WorkforcePlanningError(status === 401 || status === 403
      ? "The planning model credentials were rejected."
      : status === 429 ? "The planning model is rate limited. Try again shortly."
      : "The planning model did not return a response.");
  });
  const content = result.choices[0]?.message.content;
  if (!content) throw new WorkforcePlanningError("The planning model returned an empty response.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new WorkforcePlanningError("The planning model returned invalid JSON. Try generating the draft again.");
  }
  const parsed = workforcePlanSchema.safeParse(decoded);
  if (!parsed.success) throw new WorkforcePlanningError("The planning model returned an invalid workforce plan. Try generating the draft again.");
  return parsed.data;
}
