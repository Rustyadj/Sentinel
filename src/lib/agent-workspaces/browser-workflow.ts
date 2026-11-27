import type { Page } from "@playwright/test";
import { z } from "zod";

const selector = z.string().trim().min(1).max(500);
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("click"), selector }),
  z.strictObject({ kind: z.literal("fill"), selector, value: z.string().max(4_000) }),
  z.strictObject({ kind: z.literal("extract"), selector }),
]);

export const browserWorkflowSchema = z.array(actionSchema).min(1).max(12);

export type BrowserWorkflow = z.infer<typeof browserWorkflowSchema>;
type StepResult =
  | { index: number; kind: "click" | "fill"; status: "completed" }
  | { index: number; kind: "extract"; status: "completed"; text: string; trust: "untrusted_web_content" }
  | { index: number; kind: BrowserWorkflow[number]["kind"]; status: "failed"; error: string };

export async function runBrowserWorkflow(page: Page, actions: BrowserWorkflow) {
  const results: StepResult[] = [];
  const deadline = Date.now() + 25_000;
  for (const [index, action] of actions.entries()) {
    try {
      const timeout = Math.min(8_000, deadline - Date.now());
      if (timeout <= 0) throw new Error("Workflow deadline reached");
      const target = page.locator(action.selector);
      if (action.kind === "extract") {
        const text = await target.innerText({ timeout });
        results.push({ index, kind: action.kind, status: "completed", text: text.slice(0, 12_000), trust: "untrusted_web_content" });
      } else {
        if (action.kind === "click") await target.click({ timeout });
        else await target.fill(action.value, { timeout });
        results.push({ index, kind: action.kind, status: "completed" });
      }
    } catch {
      // Do not echo selectors, entered values or Playwright's call logs.
      results.push({ index, kind: action.kind, status: "failed", error: "The requested browser action did not complete." });
      return { status: "failed" as const, results };
    }
  }
  return { status: "completed" as const, results };
}
