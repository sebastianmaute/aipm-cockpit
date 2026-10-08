import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, openView } from "./seed";
import { OUT, RUNS, SEARCH, FILTER, SIZES, SHELL_TIMEOUT, median, timed, bootScaled, busyMs, settled } from "./perf-helpers";

// §5 perf probe, Gantt: before/after numbers for the row window (owner-approved design,
// 2026-10-08). Times the Gantt at about 500, 1000 and 2000 tasks with the same scaled
// workspaces as the table and board probes.
//
// ★ The completion signals hold with or without the window, so one probe times both: the
//   chart's scroll height (every row's 32 px is in it either way — as a row or as a spacer)
//   and the main thread going idle. A rendered-row count would not: the window renders a
//   fraction of the rows on purpose. `renderedRows` records how many WERE rendered.
//
// ★ OFF unless PERF=1, so CI skips it. Run it alone, on a fresh server:
//   PORT=3150 PERF=1 npx playwright test e2e/perf-gantt.spec.ts --project=chromium --workers=1
//   OUT_NAME=gantt-before.json keeps a before-run's numbers apart from the after-run's.

test.skip(!process.env.PERF, "perf probe: set PERF=1 to run it");
test.describe.configure({ mode: "serial" });

// The chart's own scroll box (gantt-chart.tsx). ★ Not `min-w-[480px]` alone: the outer print-root
// wrapper carries it too and comes first, and it does not scroll.
const SCROLLER = '[class*="min-h-[240px]"][class*="overflow-auto"]';

interface Result {
  size: number;
  openMs: number;
  searchMs: number;
  filterMs: number;
  toggleMs: number;
  scrollMs: number;
  renderedRows: number;
}
const results: Result[] = [];

/** The today marker spans every row (rows x 32 px) with or without the window, so its height
 *  is the row count the chart holds. (The scroll box's own scrollHeight is not: measured at
 *  609 px for 500 tasks and unchanged by a filter.) */
const scrollHeight = (page: Page) =>
  page.locator(SCROLLER).first().locator('[title="Today"]').first().evaluate((el) => (el as HTMLElement).offsetHeight);
/** Rendered task rows: each carries its `#<id>` label in the sticky name column. */
const renderedRows = (page: Page) =>
  page.locator(SCROLLER).first().evaluate((el) => el.querySelectorAll("span.font-mono").length);

for (const { size, factor } of SIZES) {
  test(`Gantt at ${size} tasks`, async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await bootScaled(page, factor);
    await openView(page, "Gantt");
    // Opening the 2002-task chart takes longer than the default 5 s on its own (14 s at 1008 before §5).
    await expect(page.locator(SCROLLER).first()).toBeVisible({ timeout: SHELL_TIMEOUT });
    const fullHeight = await settled(page, () => scrollHeight(page));

    const open: number[] = [];
    const search: number[] = [];
    const filter: number[] = [];
    const toggle: number[] = [];
    const scroll: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      await openView(page, "Milestones");
      open.push(await timed(async () => {
        await openView(page, "Gantt");
        await expect.poll(() => scrollHeight(page), { timeout: 120_000, intervals: [20] }).toBe(fullHeight);
        await busyMs(page);
      }));

      const box = page.getByRole("searchbox", { name: SEARCH, exact: true });
      search.push(await timed(async () => {
        await box.fill("a");
        expect(await settled(page, () => scrollHeight(page))).toBe(fullHeight);
      }));
      await box.fill("");
      filter.push(await timed(async () => {
        await box.fill(FILTER);
        await expect.poll(() => scrollHeight(page), { timeout: 120_000, intervals: [20] }).toBeLessThan(fullHeight);
        await settled(page, () => scrollHeight(page));
      }));
      await box.fill("");
      await expect.poll(() => scrollHeight(page), { timeout: 120_000, intervals: [20] }).toBe(fullHeight);

      // A display toggle re-renders every row: the View menu's day grid, on and back off.
      await page.getByRole("button", { name: "View", exact: true }).click();
      const grid = page.getByRole("button", { name: /Day grid/ });
      toggle.push(await timed(async () => {
        await grid.click();
        await busyMs(page);
      }));
      await grid.click();
      await page.keyboard.press("Escape");

      const scroller = page.locator(SCROLLER).first();
      scroll.push(await timed(async () => {
        await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await busyMs(page);
      }));
      expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await scroller.evaluate((el) => { el.scrollTop = 0; });
      await busyMs(page);
    }
    results.push({
      size, openMs: median(open), searchMs: median(search), filterMs: median(filter),
      toggleMs: median(toggle), scrollMs: median(scroll), renderedRows: await renderedRows(page),
    });
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${process.env.OUT_NAME ?? "gantt.json"}`, JSON.stringify(results, null, 2));
  console.table(results);
});
