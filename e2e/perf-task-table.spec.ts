import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, reseedWorkspace } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { scaleWorkspace } from "../src/app/scale-workspace";
import type { Workspace } from "../src/app/workspace";

// §5 perf probe (docs/superpowers/specs/2026-10-07-list-virtualization-design.md).
// Times the Open Points table at about 500, 1000 and 2000 tasks: opening the view, one
// inline status change, one keystroke in the search box, and one search that filters.
// Phase 0 used it to decide whether to virtualize the table; Phase 1 re-runs it for the
// after-numbers and adds one axe scan and one column-resize check with the window on.
//
// ★ OFF unless PERF=1, so CI skips it. Run it alone, on a fresh server:
//   PORT=3150 PERF=1 npx playwright test e2e/perf-task-table.spec.ts --project=chromium --workers=1
// ★ Timed on the NODE side: gotoApp installs Playwright's fake clock in the page, so an
//   in-page performance.now() would read the frozen clock.
// ★ Every timing stops only once the table holds the expected number of rows, so a
//   probe that stopped early cannot report a fast table. Above VIRTUALIZE_MIN_ROWS the
//   table renders only a window of rows, so "holds N rows" is read from the table's
//   aria-rowcount (header + N tasks + the "+ Add task" row) rather than by counting <tr>s.

const OUT = "eye-verify-output/perf";
const RUNS = 3;
const SEED_TASKS = (SEED_WORKSPACE.tasks as unknown[]).length;
// The seed has 14 tasks; these factors give 504, 1008 and 2002.
const SIZES = [
  { size: 500, factor: 36 },
  { size: 1000, factor: 72 },
  { size: 2000, factor: 143 },
] as const;
const ROWS = "tbody tr[data-deeplink-row]";
const SEARCH = "Search task name, assignee, blockers, notes…";
// ★ "a" matches EVERY seed task (each assignee name holds one), so `searchMs` times the
// keystroke's re-render, not a filter; it is kept because Phase 0's numbers used it.
// "Noah" matches 5 of the 14 seed tasks, so `filterMs` times a search that changes the list.
const FILTER = "Noah";
const POLL = { timeout: 120_000, intervals: [20] };

test.skip(!process.env.PERF, "perf probe: set PERF=1 to run it");
test.describe.configure({ mode: "serial" });

interface Result {
  size: number; tasks: number; openMs: number; statusMs: number; searchMs: number; filterMs: number; busyAfterMs: number;
}
const results: Result[] = [];

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function timed(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

/** How many tasks the Open Points table holds: its aria-rowcount when it renders a row
 *  window, else the rendered task rows. -1 while no task row is on screen. */
function tableTaskCount(page: Page): Promise<number> {
  return page.evaluate((rowSel) => {
    const table = document.querySelector(rowSel)?.closest("table");
    if (!table) return -1;
    const rowCount = table.getAttribute("aria-rowcount");
    return rowCount === null ? table.querySelectorAll(rowSel).length : Number(rowCount) - 2;
  }, ROWS);
}

/** Resolves once the task count has held still for two reads 100 ms apart. */
async function countSettled(page: Page): Promise<number> {
  let last = Number.NaN;
  for (;;) {
    const n = await tableTaskCount(page);
    if (n === last) return n;
    last = n;
    await page.waitForTimeout(100);
  }
}

async function openScaled(page: Page, factor: number): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await reseedWorkspace(page, scaleWorkspace(SEED_WORKSPACE as unknown as Workspace, factor) as unknown as Record<string, unknown>);
  await gotoApp(page);
}

for (const { size, factor } of SIZES) {
  test(`Open Points at ${size} tasks`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const expected = SEED_TASKS * factor;
    await openScaled(page, factor);

    const open: number[] = [];
    const status: number[] = [];
    const search: number[] = [];
    const filter: number[] = [];
    const busy: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      // Away and back. Not Dashboard: once the status change raises a notification its nav
      // item reads "Dashboard39", which openView's exact-name match cannot find.
      await openView(page, "Milestones");
      open.push(await timed(async () => {
        await openView(page, "Open Points");
        await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);
        await expect(page.locator(ROWS).first()).toBeVisible();
      }));

      // The first enabled one: a Jira-synced task's status select is disabled.
      const select = page.locator("tbody select[aria-label^=\"Status\"]:not([disabled])").first();
      const current = await select.inputValue();
      const next = await select.evaluate(
        (el, cur) => [...(el as HTMLSelectElement).options].map((o) => o.value).find((v) => v && v !== cur) ?? cur,
        current,
      );
      status.push(await timed(async () => {
        await select.selectOption(next);
        await expect(select).toHaveValue(next);
      }));

      const box = page.getByRole("searchbox", { name: SEARCH, exact: true });
      search.push(await timed(async () => {
        await box.fill("a");
        expect(await countSettled(page)).toBe(expected);
      }));
      await box.fill("");
      await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);

      filter.push(await timed(async () => {
        await box.fill(FILTER);
        // Wait for the debounced filter to land, THEN for the count to hold still.
        await expect.poll(() => tableTaskCount(page), POLL).not.toBe(expected);
        const n = await countSettled(page);
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(expected);
      }));
      await box.fill("");
      await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);
      // How long the page stays busy once the full list is back: a task queued from
      // Node runs only when the main thread is free. A first run hit openView's 20s
      // poll limit here at 504 tasks, so this is measured rather than assumed.
      busy.push(await timed(() => page.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)))));
    }

    results.push({
      size, tasks: expected, openMs: median(open), statusMs: median(status), searchMs: median(search),
      filterMs: median(filter), busyAfterMs: median(busy),
    });
    // ★ On the SAME page, after the timings are recorded: a second boot of the
    // 1008-task workspace missed gotoApp's 5 s once, and the 2002-task size misses it
    // every time, so a test of its own would depend on boot luck.
    if (size === 1000) {
      await test.step("virtualized: axe stays clean and a resized column keeps its width", () => virtualizedChecks(page, expected));
    }
  });
}

// Phase 1 (§5): the two shipped features a row window could break that only a real
// browser can show — the axe scan over the spacer rows and aria row counts, and column
// widths, which live on <colgroup> and must survive the window moving.
async function virtualizedChecks(page: Page, expected: number): Promise<void> {
  await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);
  // The window is on: far fewer rows rendered than the table holds.
  const rendered = await page.locator(ROWS).count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(200);
  await expect(page.locator("tbody tr[data-row-spacer]")).toHaveCount(2);

  // Same tags and same blocking filter as the axe gate in e2e/a11y.spec.ts, scoped to
  // the Open Points pane. ★ Scoped because at this size the NAV fails on its own: the
  // pink count badge (white on ui-pink, 3.82:1 at 10px) shows a 2-digit count the
  // 14-task seed never reaches. That is not the table's and is reported in §5.
  const results = await new AxeBuilder({ page })
    .include("section:has(" + ROWS + ")")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n");
  expect(blocking, `Open Points (virtualized) a11y violations:\n${summary}`).toEqual([]);

  // Widen the first resizable data column by dragging its handle.
  const header = page.locator("thead th[aria-sort]").first();
  const handle = header.locator(".cursor-col-resize");
  const before = (await header.boundingBox())!.width;
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  const resized = (await header.boundingBox())!.width;
  expect(resized).toBeGreaterThan(before + 40);

  // Scroll about 500 rows down; the window must actually move.
  await page.evaluate((rowSel) => {
    const box = document.querySelector(rowSel)!.closest(".overflow-auto")!;
    box.scrollTop = 500 * 45;
  }, ROWS);
  await expect
    .poll(async () => Number(await page.locator(ROWS).first().getAttribute("aria-rowindex")), POLL)
    .toBeGreaterThan(400);
  const after = (await header.boundingBox())!.width;
  expect(Math.abs(after - resized)).toBeLessThan(1);
  // And the rows in the moved window line up with the header: same column, same width.
  const colIndex = await header.evaluate((th) => (th as HTMLTableCellElement).cellIndex);
  const cell = page.locator(ROWS).first().locator("td").nth(colIndex);
  expect(Math.abs((await cell.boundingBox())!.width - after)).toBeLessThan(1);
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/task-table.json`, JSON.stringify(results, null, 2));
  console.table(results);
});
