import { expect, test } from "@playwright/test";
import { browserWorkflowSchema, runBrowserWorkflow } from "../../src/lib/agent-workspaces/browser-workflow";

test("real browser workflow fills, clicks, extracts, and stops on failure", async ({ page }) => {
  await page.setContent(`
    <form onsubmit="event.preventDefault(); document.querySelector('output').textContent = this.elements.lead.value;">
      <label>Lead name<input name="lead"></label><button type="submit">Save draft</button>
    </form>
    <output></output><button disabled>Unavailable</button>
  `);
  const workflow = browserWorkflowSchema.parse([
    { kind: "fill", selector: "input", value: "Titan ICF" },
    { kind: "click", selector: "button[type=submit]" },
    { kind: "extract", selector: "output" },
    { kind: "click", selector: "button[disabled]" },
    { kind: "extract", selector: "form" },
  ]);
  const result = await runBrowserWorkflow(page, workflow);
  expect(result.status).toBe("failed");
  expect(result.results).toHaveLength(4);
  expect(result.results[2]).toMatchObject({ text: "Titan ICF", trust: "untrusted_web_content" });
  expect(result.results[3]).toMatchObject({ status: "failed" });
});
