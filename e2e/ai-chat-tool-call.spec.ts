import type { Route } from "@playwright/test";
import { test, expect, gotoApp, openView } from "./seed";

/**
 * §234 (c) — one AI chat turn with a tool call, end to end, against a MOCKED
 * Anthropic API (`page.route`). The browser calls api.anthropic.com directly
 * (`chat-api.ts`), so the route sees exactly what the app sends. The mock answers
 * the first request with a `create_task` tool call and the second, which must carry
 * that call's result, with a closing text. A single `create_task` applies at once
 * (`shouldStage` stages only destructive calls or more than one write), so the task
 * must then exist in the workspace.
 *
 * ★ The key is fake and never leaves this test: every request to the API host is
 * fulfilled by the route, and an unexpected one fails the test.
 */

const API = "https://api.anthropic.com";
const TASK_NAME = "zq e2e task created by a mocked tool call";
const TOOL_USE_ID = "toolu_e2e_0001";

type Body = { messages?: { role: string; content: unknown }[] };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function message(content: unknown[], stopReason: string) {
  return {
    id: `msg_e2e_${stopReason}`,
    type: "message",
    role: "assistant",
    model: "claude-e2e",
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

/** The tool_result blocks in a request's last user message. */
function toolResults(body: Body): { tool_use_id?: string; is_error?: boolean; content?: unknown }[] {
  const last = body.messages?.[body.messages.length - 1];
  if (!last || !Array.isArray(last.content)) return [];
  return (last.content as { type?: string }[]).filter((b) => b.type === "tool_result") as never;
}

test("a chat turn's create_task tool call creates the task and reports its result back", async ({ page }) => {
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

  const requests: Body[] = [];
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
      const body = req.postDataJSON() as Body;
      requests.push(body);
      const reply = toolResults(body).length > 0
        ? message([{ type: "text", text: "Done: I created the task." }], "end_turn")
        : message(
          [{ type: "tool_use", id: TOOL_USE_ID, name: "create_task", input: { taskName: TASK_NAME, assignee: "Ada", dueDate: "2026-12-01" } }],
          "tool_use",
        );
      return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(reply) });
    }
    unexpected.push(`${req.method()} ${url.pathname}`);
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });

  await gotoApp(page);
  await openView(page, "AI Assistant");
  const input = page.getByPlaceholder("Ask Claude about your tasks…", { exact: true });
  await expect(input).toBeEnabled({ timeout: 20_000 });
  await input.fill("Please create a task for Ada.");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText("Done: I created the task.", { exact: true })).toBeVisible({ timeout: 20_000 });
  // Two requests: the user's message, then the tool result for the same call id, not an error.
  expect(requests).toHaveLength(2);
  const results = toolResults(requests[1]);
  expect(results).toHaveLength(1);
  expect(results[0].tool_use_id).toBe(TOOL_USE_ID);
  expect(results[0].is_error ?? false).toBe(false);
  expect(unexpected).toEqual([]);

  // The write landed in the workspace: the task is on the Open Points table.
  await openView(page, "Open Points");
  // Scoped to the table: the chat transcript may also echo the tool call's input.
  await expect(page.getByRole("table").getByText(TASK_NAME, { exact: true })).toBeVisible();
});
