import type { Route } from "@playwright/test";
import { test, expect, gotoApp, openView } from "./seed";

// The eye-check KIT for "Optimize with AI" (§3). It opens the preview over the
// seeded Open Points against a MOCKED Anthropic API (`page.route`, the way
// ai-chat-tool-call.spec.ts stubs it): the forced call is answered with a canned
// `propose_wbs_changes` tool_use holding one item of each kind. It asserts only
// that it REACHED each state, because a screenshot of the wrong state looks like
// evidence, and saves two shots for the owner: the preview as proposed, and the
// preview with the new task unticked, so the link that needs it is disabled.
//
// ★ OFF unless EYE_VERIFY=1, so CI's e2e job skips it. Run it alone:
//   EYE_VERIFY=1 npx playwright test e2e/wbs-plan-eye.spec.ts --project=chromium --workers=1
// ★ Shots go to eye-verify-output/wbs-plan/ (git-ignored), or to EYE_VERIFY_OUT.
// ★ The key is fake and never leaves this test: every request to the API host is
//   fulfilled by the route, and an unexpected one fails the test.

const OUT = process.env.EYE_VERIFY_OUT ?? "eye-verify-output/wbs-plan";
const API = "https://api.anthropic.com";
const NEW_TASK = "Write the cutover runbook";

test.skip(!process.env.EYE_VERIFY, "eye-verify kit: set EYE_VERIFY=1 to run it");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

// Seeded ids (sample-workspace-small.json): 7 "Security review", 11 "Quarterly
// OKR review", 6 "Migration script for legacy users" and 10 "Production
// cutover" are open, not Jira-synced, and 6 → 7 and runbook → 10 close no cycle.
const PROPOSAL = {
  items: [
    {
      kind: "split",
      taskId: 7,
      pieces: [{ taskName: "Security review: threat model" }, { taskName: "Security review: penetration test", estimateMinutes: 960 }],
      why: "Two kinds of work with different owners.",
    },
    { kind: "regroup", taskId: 11, group: "Governance", why: "A governance ritual, not operations." },
    { kind: "newTask", ref: "runbook", taskName: NEW_TASK, dueDate: "2026-10-20", group: "Auth Migration", why: "The cutover has no runbook." },
    { kind: "estimate", target: { ref: "runbook" }, estimateMinutes: 240, why: "Half a day." },
    { kind: "link", from: { taskId: 6 }, to: { taskId: 7 }, why: "Review the migration script too." },
    { kind: "link", from: { ref: "runbook" }, to: { taskId: 10 }, why: "Cut over by the runbook." },
  ],
};

test("the Optimize with AI preview, as proposed and with a link disabled", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({
        tourSeen: true,
        ai: {
          enabled: true,
          apiKey: "sk-ant-e2e-mocked-key-not-real-0000",
          consentAccepted: true,
          groundInGuides: false,
        },
      }),
    );
  });

  const forcedTools: string[] = [];
  const unexpected: string[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (url.pathname === "/v1/models") {
      return route.fulfill({
        status: 200, headers: CORS, contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "claude-e2e", type: "model", display_name: "E2E" }], has_more: false }),
      });
    }
    if (url.pathname === "/v1/messages" && req.method() === "POST") {
      const body = req.postDataJSON() as { tool_choice?: { name?: string } };
      forcedTools.push(body.tool_choice?.name ?? "");
      const reply = {
        id: "msg_e2e_wbs",
        type: "message",
        role: "assistant",
        model: "claude-e2e",
        content: [{ type: "tool_use", id: "toolu_e2e_wbs", name: "propose_wbs_changes", input: PROPOSAL }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(reply) });
    }
    unexpected.push(`${req.method()} ${url.pathname}`);
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });

  await gotoApp(page);
  await openView(page, "Open Points");
  await page.getByRole("button", { name: "Optimize with AI", exact: true }).click();
  await page.getByRole("button", { name: "Propose", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Split tasks", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(NEW_TASK, { exact: true }).first()).toBeVisible();
  expect(forcedTools).toEqual(["propose_wbs_changes"]);
  expect(unexpected).toEqual([]);
  await page.screenshot({ path: `${OUT}/wbs-plan-preview.png`, fullPage: false });

  // Untick the new task: the link that cites its ref is disabled, with the reason shown.
  const newTasks = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "New tasks", exact: true }),
  });
  await newTasks.getByRole("checkbox").uncheck();
  await expect(dialog.getByText("Needs the change that creates one of its tasks.", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/wbs-plan-preview-link-disabled.png`, fullPage: false });

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
