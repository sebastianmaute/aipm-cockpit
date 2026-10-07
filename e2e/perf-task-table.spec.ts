import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, openView, reseedWorkspace, FROZEN_NOW, NAV_SELECTOR } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { scaleWorkspace } from "../src/app/scale-workspace";
import type { Workspace } from "../src/app/workspace";

// §5 perf probe (docs/superpowers/specs/2026-10-07-list-virtualization-design.md).
// Times the Open Points table at about 500, 1000 and 2000 tasks: opening the view, one
// inline status change, one keystroke in the search box, one search that filters, and
// one scroll of SCROLL_ROWS rows. Phase 0 used it to decide whether to virtualize the
// table; Phase 1 re-runs it for the after-numbers and, at 1008 tasks, checks what a
// row window could break that only a real browser shows.
//
// ★ OFF unless PERF=1, so CI skips it. Run it alone, on a fresh server:
//   PORT=3150 PERF=1 npx playwright test e2e/perf-task-table.spec.ts --project=chromium --workers=1
// ★ Timed on the NODE side: the boot installs Playwright's fake clock in the page, so an
//   in-page performance.now() would read the frozen clock.
// ★ Every timing stops only once the table holds the number of rows it should, so a
//   probe that stopped early cannot report a fast table. Above VIRTUALIZE_MIN_ROWS the
//   table renders only a window of rows, so "holds N rows" is read from the table's
//   aria-rowcount (header + N tasks + the "+ Add task" row) rather than by counting <tr>s.
//   Where N is known in advance (the full list, and "a", which matches every task) the
//   timing waits for exactly N. For FILTER it is NOT computed here: the app's search
//   haystack runs each description through descriptionText, which needs DOMPurify and so
//   a DOM (rich-text-projection.ts is browser-only), and a Node-side copy would be an
//   approximation. That timing waits for the count to LEAVE the full count and then to
//   hold still for SETTLE_MS.
// ★ SETTLE_MS is twice the search debounce (150 ms, filters-context.tsx), so a count
//   read twice SETTLE_MS apart cannot be a count from before the debounce fired. It also
//   puts a SETTLE_MS floor under `searchMs` and `filterMs`: "a" changes no row, so the
//   only way to see the keystroke land is to wait out the debounce.

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
const SPACERS = "tbody tr[data-row-spacer]";
const SEARCH = "Search task name, assignee, blockers, notes…";
// ★ "a" matches EVERY seed task (each assignee name holds one), so `searchMs` times the
// keystroke's re-render, not a filter; it is kept because Phase 0's numbers used it.
// "Noah" matches 5 of the 14 seed tasks, so `filterMs` times a search that changes the list.
const FILTER = "Noah";
// One seed task, "Quarterly OKR review": 72 rows at 1008 tasks, under the threshold.
const SMALL_FILTER = "Quarterly";
const SETTLE_MS = 300;
const SCROLL_ROWS = 400;
const ROW_PX = 45; // TASK_ROW_ESTIMATE_PX
const SHELL_TIMEOUT = 180_000;
const POLL = { timeout: 120_000, intervals: [20] };

test.skip(!process.env.PERF, "perf probe: set PERF=1 to run it");
test.describe.configure({ mode: "serial" });

interface Result {
  size: number;
  tasks: number;
  openMs: number;
  statusMs: number;
  searchMs: number;
  filterMs: number;
  scrollMs: number;
  busyAfterMs: number;
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

/** Resolves once the task count has held still for two reads SETTLE_MS apart. */
async function countSettled(page: Page): Promise<number> {
  let last = Number.NaN;
  for (;;) {
    const n = await tableTaskCount(page);
    if (n === last) return n;
    last = n;
    await page.waitForTimeout(SETTLE_MS);
  }
}

/** The table's scroll box. */
function scrollBox(page: Page) {
  return page.locator(ROWS).first().locator("xpath=ancestor::div[contains(@class,'overflow-auto')][1]");
}

const setScrollTop = (page: Page, top: number) =>
  scrollBox(page).evaluate((el, y) => {
    el.scrollTop = y;
  }, top);
const getScrollTop = (page: Page) => scrollBox(page).evaluate((el) => el.scrollTop);

/** The smallest / largest aria-rowindex among the rendered task rows. ★ Read the
 *  bottom while a row holds focus: the window keeps that row rendered, so it can be
 *  the smallest index wherever the window is. */
function rowIndexes(page: Page): Promise<number[]> {
  return page.evaluate(
    (rowSel) => [...document.querySelectorAll(rowSel)].map((r) => Number(r.getAttribute("aria-rowindex"))),
    ROWS,
  );
}
/** The aria-rowindex of the first task row visible below the sticky header — the row
 *  a reader sees at the top of the table. */
function topVisibleRow(page: Page): Promise<number> {
  return scrollBox(page).evaluate((el, rowSel) => {
    const headBottom = el.querySelector("thead")!.getBoundingClientRect().bottom;
    const row = [...el.querySelectorAll(rowSel)].find((r) => r.getBoundingClientRect().bottom > headBottom + 1);
    return row ? Number(row.getAttribute("aria-rowindex")) : -1;
  }, ROWS);
}
const windowTop = async (page: Page) => Math.min(...(await rowIndexes(page)));
const windowBottom = async (page: Page) => Math.max(...(await rowIndexes(page)));

/** gotoApp's two waits with a longer limit: the 2002-task workspace takes longer than
 *  gotoApp's default 5 s to show the shell, and raising that for every spec would hide
 *  a slow boot everywhere else. */
async function bootScaled(page: Page, factor: number): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await reseedWorkspace(page, scaleWorkspace(SEED_WORKSPACE as unknown as Workspace, factor) as unknown as Record<string, unknown>);
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

for (const { size, factor } of SIZES) {
  test(`Open Points at ${size} tasks`, async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const expected = SEED_TASKS * factor;
    await bootScaled(page, factor);

    const open: number[] = [];
    const status: number[] = [];
    const search: number[] = [];
    const filter: number[] = [];
    const scroll: number[] = [];
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
        // The debounced filter has landed once the count leaves the full count; then
        // wait for it to hold still. Its value is not known in advance (see the header).
        await expect.poll(() => tableTaskCount(page), POLL).not.toBe(expected);
        expect(await countSettled(page)).toBeGreaterThan(0);
      }));
      await box.fill("");
      await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);

      // Focus is in the search box, outside the table, so no row is held in the window.
      scroll.push(await timed(async () => {
        await setScrollTop(page, SCROLL_ROWS * ROW_PX);
        // The offset maps to a row through measured heights where known and the 45 px
        // estimate elsewhere, so wait for the window to leave the top, not for row 400.
        await expect.poll(() => windowTop(page), POLL).toBeGreaterThan(SCROLL_ROWS / 8);
      }));
      await setScrollTop(page, 0);
      await expect.poll(() => windowTop(page), POLL).toBe(2);

      // How long the page stays busy once the full list is back: a task queued from
      // Node runs only when the main thread is free. A first run hit openView's 20s
      // poll limit here at 504 tasks, so this is measured rather than assumed.
      busy.push(await timed(() => page.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)))));
    }

    results.push({
      size, tasks: expected, openMs: median(open), statusMs: median(status), searchMs: median(search),
      filterMs: median(filter), scrollMs: median(scroll), busyAfterMs: median(busy),
    });
    // ★ On the SAME page, after the timings are recorded: a second boot of a large
    // workspace is slow, so a test of its own would mostly time the boot again.
    if (size === 1000) {
      await test.step("virtualized: axe stays clean and a resized column keeps its width", () => virtualizedChecks(page, expected));
      await test.step("the scroll position survives a print", () => scrollSurvivesPrint(page, expected));
      await test.step("the scroll position survives the list growing past the threshold", () => scrollSurvivesThreshold(page, expected));
      await test.step("an inline edit survives its row scrolling out of the window", () => inlineEditSurvivesScroll(page));
    }
  });
}

// Phase 1 (§5): the two shipped features a row window could break that only a real
// browser can show — the axe scan over the spacer rows and aria row counts, and column
// widths, which live on <colgroup> and must survive the window moving.
async function virtualizedChecks(page: Page, expected: number): Promise<void> {
  await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // The window is on: far fewer rows rendered than the table holds.
  const rendered = await page.locator(ROWS).count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(200);
  await expect(page.locator(SPACERS)).toHaveCount(2);
  // ★ A6: the tbody's divide-y must not draw a line across a spacer.
  for (const width of await page.locator(SPACERS).evaluateAll((els) => els.map((el) => getComputedStyle(el).borderBottomWidth))) {
    expect(width).toBe("0px");
  }

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
  await setScrollTop(page, 500 * ROW_PX);
  await expect.poll(() => windowTop(page), POLL).toBeGreaterThan(400);
  const after = (await header.boundingBox())!.width;
  expect(Math.abs(after - resized)).toBeLessThan(1);
  // And the rows in the moved window line up with the header: same column, same width.
  const colIndex = await header.evaluate((th) => (th as HTMLTableCellElement).cellIndex);
  const cell = page.locator(ROWS).first().locator("td").nth(colIndex);
  expect(Math.abs((await cell.boundingBox())!.width - after)).toBeLessThan(1);
}

// ★ A1: while the window is off, the virtualizer forgets its scroll offset, and turning
// back on used to scroll the box to 0. Printing switches it off and back on.
async function scrollSurvivesPrint(page: Page, expected: number): Promise<void> {
  await setScrollTop(page, 500 * ROW_PX);
  await expect.poll(() => windowTop(page), POLL).toBeGreaterThan(400);
  const before = await getScrollTop(page);
  const beforeRow = await topVisibleRow(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(ROWS)).toHaveCount(expected, { timeout: POLL.timeout });
  await page.emulateMedia({ media: null });
  await expect(page.locator(SPACERS)).toHaveCount(2, { timeout: POLL.timeout });
  // Give a scroll-to-0, or a correction from re-measuring, a chance to land first.
  await page.waitForTimeout(SETTLE_MS);
  expect(Math.abs((await getScrollTop(page)) - before)).toBeLessThanOrEqual(ROW_PX);
  // ★ The row the reader saw, too: the window comes back on with its measured heights
  // restored, so the same offset still maps to the same row.
  expect(Math.abs((await topVisibleRow(page)) - beforeRow)).toBeLessThanOrEqual(1);
}

// ★ A1, second path: a filter under the threshold turns the window off; clearing it
// turns the window back on with the box wherever the short list left it.
async function scrollSurvivesThreshold(page: Page, expected: number): Promise<void> {
  const box = page.getByRole("searchbox", { name: SEARCH, exact: true });
  await box.fill(SMALL_FILTER);
  await expect.poll(() => tableTaskCount(page), POLL).toBeLessThan(200);
  expect(await countSettled(page)).toBeGreaterThan(0);
  await expect(page.locator(SPACERS)).toHaveCount(0);
  await setScrollTop(page, 30 * ROW_PX);
  const before = await getScrollTop(page);
  expect(before).toBeGreaterThan(20 * ROW_PX); // the short list is tall enough to scroll
  await box.fill("");
  await expect.poll(() => tableTaskCount(page), POLL).toBe(expected);
  await expect(page.locator(SPACERS)).toHaveCount(2, { timeout: POLL.timeout });
  await page.waitForTimeout(SETTLE_MS);
  expect(Math.abs((await getScrollTop(page)) - before)).toBeLessThanOrEqual(ROW_PX);
}

// ★ A2: an inline edit keeps its draft in the row's state and commits it on blur; an
// unmounted row fires no blur, so the window must keep the focused row rendered.
async function inlineEditSurvivesScroll(page: Page): Promise<void> {
  await setScrollTop(page, 0);
  await expect.poll(() => windowTop(page), POLL).toBe(2);
  // A row whose due date edits inline: a Jira-synced row (disabled status select) has none.
  const dueButton = page.locator(`${ROWS}:has(select[aria-label^="Status"]:not([disabled])) button[aria-label^="Due date – "]`).first();
  const rowId = await dueButton.evaluate((b) => b.closest("tr")!.getAttribute("data-deeplink-row"));
  await dueButton.click();
  const input = page.locator(`tr[data-deeplink-row="${rowId}"] input[aria-label^="Due date – "]`);
  await expect(input).toBeFocused();
  const draft = "2031-02-03";
  await input.fill(draft);
  await expect(input).toHaveValue(draft);

  // A programmatic scroll does not move focus, as a wheel scroll would not.
  await setScrollTop(page, 600 * ROW_PX);
  await expect.poll(() => windowBottom(page), POLL).toBeGreaterThan(300);
  await expect(input).toHaveCount(1);
  await expect(input).toHaveValue(draft);
  await expect(input).toBeFocused();

  await setScrollTop(page, 0);
  await expect.poll(() => windowTop(page), POLL).toBe(2);
  await expect(input).toHaveValue(draft);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/task-table.json`, JSON.stringify(results, null, 2));
  console.table(results);
});
