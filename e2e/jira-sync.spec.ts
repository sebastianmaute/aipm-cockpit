import type { Route } from "@playwright/test";
import { test, expect, gotoApp, openView } from "./seed";

/**
 * §234 (a) — "Sync with Jira", end to end, against MOCKED `/api/jira/*` routes
 * (`page.route`). The browser talks only to the app's own proxy routes
 * (`jira-api.ts`); mocking them in the browser exercises the client half of the
 * round trip — the scope's JQL, the search request carrying the configured
 * credentials, the response validation, and the import of an unseen issue as a
 * new task — without reaching Atlassian. The server proxy itself
 * (`app/api/jira/*`, SSRF guard included) is NOT driven here; its own unit tests
 * cover it.
 *
 * ★ The token is fake and never leaves the browser: every `/api/jira/*` request is
 * fulfilled by the route.
 */

const SUMMARY = "zq e2e issue imported by a mocked Jira sync";

test("Sync with Jira imports an unseen issue as a new task and reports it", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({
        tourSeen: true,
        jira: {
          enabled: true,
          siteUrl: "https://e2e-mock.atlassian.net",
          email: "e2e@example.com",
          apiToken: "e2e-mocked-jira-token-not-real",
          projectKey: "E2E",
          projectName: "E2E Project",
          extraProjects: [],
          issueTypes: [],
          assigneeMode: "any",
          assigneeAccountId: "",
          assigneeDisplayName: "",
          tokenExpiresAt: "",
        },
      }),
    );
  });

  const searches: Record<string, unknown>[] = [];
  const other: string[] = [];
  await page.route("**/api/jira/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/jira/search") {
      searches.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isLast: true,
          issues: [{
            key: "E2E-1",
            fields: {
              summary: SUMMARY,
              duedate: "2026-12-01",
              updated: "2026-06-01T10:00:00.000+0000",
              resolutiondate: null,
              labels: [],
              assignee: null,
              priority: { name: "Medium" },
              status: { name: "To Do", statusCategory: { key: "new" } },
            },
          }],
        }),
      });
    }
    other.push(`${req.method()} ${path}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await gotoApp(page);
  await openView(page, "Open Points");
  await page.getByRole("button", { name: "Sync with Jira", exact: true }).click();

  await expect(page.getByText("Synced 1 issue: 1 new, 0 pulled, 0 pushed.", { exact: true })).toBeVisible({ timeout: 20_000 });
  // One search, scoped by the configured project and carrying the configured credentials.
  expect(searches).toHaveLength(1);
  expect(searches[0].jql).toBe('project = "E2E" ORDER BY updated DESC');
  expect(searches[0]).toMatchObject({ siteUrl: "https://e2e-mock.atlassian.net", email: "e2e@example.com" });
  // The issue is now a task on the table.
  await expect(page.getByRole("table").getByText(SUMMARY, { exact: true })).toBeVisible();
  // The sync pushed nothing back: no seeded task is linked to Jira.
  expect(other.filter((o) => /update-issue|transition-issue|create-issue/.test(o))).toEqual([]);
});
