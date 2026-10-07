import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, reseedWorkspace } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { scaleWorkspace } from "../src/app/scale-workspace";
import type { Workspace } from "../src/app/workspace";

// §5 perf probe (docs/superpowers/specs/2026-10-07-list-virtualization-design.md, Phase 0).
// Times the Open Points table at about 500, 1000 and 2000 tasks: opening the view, one
// inline status change, and one keystroke in the search box. It decides whether the
// table gets virtualized: Phase 1 is built only if a 1000-task median exceeds 200 ms.
//
// ★ OFF unless PERF=1, so CI skips it. Run it alone, on a fresh server:
//   PORT=3150 PERF=1 npx playwright test e2e/perf-task-table.spec.ts --project=chromium --workers=1
// ★ Timed on the NODE side: gotoApp installs Playwright's fake clock in the page, so an
//   in-page performance.now() would read the frozen clock.
// ★ Every timing stops only once the table holds the expected number of rows, so a
//   probe that stopped early cannot report a fast table.

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

test.skip(!process.env.PERF, "perf probe: set PERF=1 to run it");
test.describe.configure({ mode: "serial" });

interface Result { size: number; tasks: number; openMs: number; statusMs: number; searchMs: number; busyAfterMs: number }
const results: Result[] = [];

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function timed(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

/** Resolves once the row count has held still for two reads 100 ms apart. */
async function rowsSettled(page: Page): Promise<number> {
  let last = -1;
  for (;;) {
    const n = await page.locator(ROWS).count();
    if (n === last) return n;
    last = n;
    await page.waitForTimeout(100);
  }
}

for (const { size, factor } of SIZES) {
  test(`Open Points at ${size} tasks`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const expected = SEED_TASKS * factor;
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
    await reseedWorkspace(page, scaleWorkspace(SEED_WORKSPACE as unknown as Workspace, factor) as unknown as Record<string, unknown>);
    await gotoApp(page);

    const open: number[] = [];
    const status: number[] = [];
    const search: number[] = [];
    const busy: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      // Away and back. Not Dashboard: once the status change raises a notification its nav
      // item reads "Dashboard39", which openView's exact-name match cannot find.
      await openView(page, "Milestones");
      open.push(await timed(async () => {
        await openView(page, "Open Points");
        await expect(page.locator(ROWS)).toHaveCount(expected, { timeout: 120_000 });
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
        const n = await rowsSettled(page);
        expect(n).toBeLessThanOrEqual(expected);
      }));
      await box.fill("");
      await expect(page.locator(ROWS)).toHaveCount(expected, { timeout: 120_000 });
      // How long the page stays busy once the full list is back: a task queued from
      // Node runs only when the main thread is free. A first run hit openView's 20s
      // poll limit here at 504 tasks, so this is measured rather than assumed.
      busy.push(await timed(() => page.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)))));
    }

    results.push({ size, tasks: expected, openMs: median(open), statusMs: median(status), searchMs: median(search), busyAfterMs: median(busy) });
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/task-table.json`, JSON.stringify(results, null, 2));
  console.table(results);
});
