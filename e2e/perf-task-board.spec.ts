import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, openView } from "./seed";
import {
  OUT, RUNS, SEED_TASKS, SIZES, SEARCH, FILTER, POLL,
  median, timed, settled, bootScaled, busyMs,
} from "./perf-helpers";

// §5 perf probe, Kanban board, Phase 0 of the board's own decision (the table's spec,
// docs/superpowers/specs/2026-10-07-list-virtualization-design.md, leaves the board out of
// scope until it is measured). Times the board at about 500, 1000 and 2000 tasks with the
// same workspaces and the same steps as perf-task-table.spec.ts, so each number can be set
// beside the virtualized table's: the DIFFERENCE is the board's own cost. ★ That pairing is
// the point: at 1008 tasks the table's status change still took about 2.2 s with about 30
// rows rendered, so most of a number here is the pane around the board, not the board.
//
// ★ OFF unless PERF=1, so CI skips it. Run it alone, on a fresh server, right after the
//   table probe so both sets come from the same machine state:
//   PORT=3150 PERF=1 npx playwright test e2e/perf-task-board.spec.ts --project=chromium --workers=1
// ★ The board renders every card (nothing is virtualized), so "holds N tasks" is a plain
//   count of the cards, and each timing stops only once that count is what it should be.

const CARDS = "article[data-testid^=\"kanban-card-\"]";
const COLUMNS = "section[data-testid^=\"kanban-col-\"]";

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
  fullestColumn: number;
}
const results: Result[] = [];

const cardCount = (page: Page): Promise<number> => page.locator(CARDS).count();

/** The scroll box of the column holding the most cards, and that count. */
async function fullestColumn(page: Page): Promise<{ index: number; cards: number }> {
  const counts = await page.locator(COLUMNS).evaluateAll((cols, sel) => cols.map((c) => c.querySelectorAll(sel).length), CARDS);
  const cards = Math.max(...counts);
  return { index: counts.indexOf(cards), cards };
}

for (const { size, factor } of SIZES) {
  test(`Open Points board at ${size} tasks`, async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const expected = SEED_TASKS * factor;
    await bootScaled(page, factor);
    await openView(page, "Open Points");
    await page.getByRole("radio", { name: "Board", exact: true }).click();
    await expect.poll(() => cardCount(page), POLL).toBe(expected);

    const open: number[] = [];
    const status: number[] = [];
    const search: number[] = [];
    const filter: number[] = [];
    const scroll: number[] = [];
    const busy: number[] = [];
    let fullest = 0;
    for (let run = 0; run < RUNS; run++) {
      // Away and back, as the table probe does (and not via Dashboard, for the same reason).
      await openView(page, "Milestones");
      open.push(await timed(async () => {
        await openView(page, "Open Points");
        await expect.poll(() => cardCount(page), POLL).toBe(expected);
        await expect(page.locator(CARDS).first()).toBeVisible();
      }));

      // The first enabled card status select: a Jira-synced card's is disabled. The
      // change moves the card to another column, so wait for the moved card, not the select.
      const select = page.locator(`${CARDS} select[aria-label^="Status"]:not([disabled])`).first();
      const cardId = await select.evaluate((el) => el.closest("article")!.getAttribute("data-testid"));
      const current = await select.inputValue();
      const next = await select.evaluate(
        (el, cur) => [...(el as HTMLSelectElement).options].map((o) => o.value).find((v) => v && v !== cur) ?? cur,
        current,
      );
      status.push(await timed(async () => {
        await select.selectOption(next);
        await expect(page.locator(`[data-testid="kanban-col-${next}"] [data-testid="${cardId}"]`)).toHaveCount(1, { timeout: POLL.timeout });
      }));

      const box = page.getByRole("searchbox", { name: SEARCH, exact: true });
      search.push(await timed(async () => {
        await box.fill("a");
        expect(await settled(page, () => cardCount(page))).toBe(expected);
      }));
      await box.fill("");
      await expect.poll(() => cardCount(page), POLL).toBe(expected);

      filter.push(await timed(async () => {
        await box.fill(FILTER);
        await expect.poll(() => cardCount(page), POLL).not.toBe(expected);
        expect(await settled(page, () => cardCount(page))).toBeGreaterThan(0);
      }));
      await box.fill("");
      await expect.poll(() => cardCount(page), POLL).toBe(expected);

      // Scroll the fullest column to its end. Every card is already rendered, so this times
      // the scroll and the paint that follows it: done once the main thread is free again.
      const col = await fullestColumn(page);
      fullest = col.cards;
      const scroller = page.locator(COLUMNS).nth(col.index).locator("div.overflow-auto");
      scroll.push(await timed(async () => {
        await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await busyMs(page);
      }));
      expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await scroller.evaluate((el) => { el.scrollTop = 0; });

      busy.push(await busyMs(page));
    }

    results.push({
      size, tasks: expected, openMs: median(open), statusMs: median(status), searchMs: median(search),
      filterMs: median(filter), scrollMs: median(scroll), busyAfterMs: median(busy), fullestColumn: fullest,
    });
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/task-board.json`, JSON.stringify(results, null, 2));
  console.table(results);
});
