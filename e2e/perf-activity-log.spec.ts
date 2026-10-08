import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, openView, reseedWorkspace, FROZEN_NOW, NAV_SELECTOR } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { OUT, RUNS, SETTLE_MS, SHELL_TIMEOUT, POLL, median, timed, settled, busyMs } from "./perf-helpers";
import { ACTIVITY_MAX_ENTRIES } from "../src/app/activity-log";

// §5 perf probe, activity log: Phase 0 of its own decision (owner, 2026-10-08: measure, and
// drop it from §5 if it is fast). The log is capped at ACTIVITY_MAX_ENTRIES (500, §510), so
// it can never be larger than this probe makes it. It times the Activity view twice on the
// same machine: with the seed's own few entries, and with a full log of 500. The view around
// the list costs the same in both, so the DIFFERENCE is the list's own cost.
//
// ★ OFF unless PERF=1, so CI skips it. Run it alone, on a fresh server:
//   PORT=3150 PERF=1 npx playwright test e2e/perf-activity-log.spec.ts --project=chromium --workers=1

test.skip(!process.env.PERF, "perf probe: set PERF=1 to run it");
test.describe.configure({ mode: "serial" });

const ROWS = "main table tbody tr";
const SEARCH = "Search (text, wildcards, or regex)…";

interface Result {
  entries: number;
  openMs: number;
  searchMs: number;
  filterMs: number;
  sortMs: number;
  scrollMs: number;
}
const results: Result[] = [];

/** `n` task.updated entries a minute apart, newest first, each with one field change. */
function fullLog(n: number): unknown[] {
  const base = Date.parse("2026-06-01T12:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    id: `perf-${i}`,
    timestamp: new Date(base - i * 60_000).toISOString(),
    kind: "task.updated",
    args: [i + 1, `Task ${i + 1}`],
    actor: "user",
    changes: [{ field: "status", from: "To Do", to: i % 2 ? "Done" : "In Progress" }],
  }));
}

async function boot(page: Page, activityLog: unknown[] | null): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  const ws = { ...(SEED_WORKSPACE as Record<string, unknown>) };
  if (activityLog) ws.activityLog = activityLog;
  await reseedWorkspace(page, ws);
  await page.clock.install({ time: FROZEN_NOW });
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible({ timeout: SHELL_TIMEOUT });
  await page.waitForFunction(
    ({ name, sel }) =>
      [...document.querySelectorAll(sel)].some(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      ),
    { name: "Dashboard", sel: NAV_SELECTOR },
    { timeout: SHELL_TIMEOUT },
  );
}

/** The rows the table holds: rendered, plus the ones the §5 cap hides behind "Show more",
 *  whose name ends "(N hidden)". Holds with and without the cap. */
async function rowCount(page: Page): Promise<number> {
  const rendered = await page.locator(ROWS).count();
  const more = page.getByTestId("activity-show-more");
  if ((await more.count()) === 0) return rendered;
  const hidden = /\((\d+) hidden\)/.exec((await more.textContent()) ?? "");
  return rendered + Number(hidden?.[1] ?? 0);
}

for (const full of [false, true]) {
  test(`Activity view, ${full ? "full log" : "seed log"}`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await boot(page, full ? fullLog(ACTIVITY_MAX_ENTRIES) : null);
    await openView(page, "Activity");
    const expected = await settled(page, () => rowCount(page));
    // The seeded 500 plus the entries the app itself writes while it boots.
    if (full) expect(expected).toBeGreaterThanOrEqual(ACTIVITY_MAX_ENTRIES);
    else expect(expected).toBeGreaterThan(0);

    const open: number[] = [];
    const search: number[] = [];
    const filter: number[] = [];
    const sort: number[] = [];
    const scroll: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      await openView(page, "Milestones");
      open.push(await timed(async () => {
        await openView(page, "Activity");
        await expect.poll(() => rowCount(page), POLL).toBe(expected);
      }));

      const box = page.getByRole("searchbox", { name: SEARCH, exact: true });
      // Every entry's message holds "Task", so this times a keystroke's re-render, not a filter.
      search.push(await timed(async () => {
        await box.fill("Task");
        // Every FULL-log entry matches; the seed log's other kinds do not, so only the full run asserts it.
        const n = await settled(page, () => rowCount(page));
        if (full) expect(n).toBe(expected);
      }));
      await box.fill("");
      await expect.poll(() => rowCount(page), POLL).toBe(expected);

      filter.push(await timed(async () => {
        await box.fill("Task 7");
        await expect.poll(() => rowCount(page), POLL).not.toBe(expected);
        const n = await settled(page, () => rowCount(page));
        if (full) expect(n).toBeGreaterThan(0);
      }));
      await box.fill("");
      await expect.poll(() => rowCount(page), POLL).toBe(expected);

      // Sort by message and back: a full re-order of every row.
      const header = page.getByRole("button", { name: /^Message/ });
      sort.push(await timed(async () => {
        await header.click();
        await busyMs(page);
      }));
      await header.click();
      await page.waitForTimeout(SETTLE_MS);

      const scroller = page.locator("main div.overflow-auto:has(table)").first();
      scroll.push(await timed(async () => {
        await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await busyMs(page);
      }));
      await scroller.evaluate((el) => { el.scrollTop = 0; });
    }
    results.push({
      entries: expected, openMs: median(open), searchMs: median(search), filterMs: median(filter),
      sortMs: median(sort), scrollMs: median(scroll),
    });
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/activity-log.json`, JSON.stringify(results, null, 2));
  console.table(results);
});
