import { test, expect, gotoApp, openView } from "./seed";
import { REPORTS_LAYOUT_KEY } from "../src/app/report-blocks";

/**
 * The Reports "At a glance" block (`stats`) sizes its height to its content, as
 * every Dashboard tile does, until the user sets one from the ⋮ menu.
 *
 * ★★ Why this spec exists: at the catalogue's fixed 2 rows, a strip that wraps
 * to two rows of cells (a narrow window, or the block resized to width 2)
 * overflowed its body by 31px and scrolled. jsdom has no layout, so no unit test
 * can see a measured height; this is the only detector.
 */

/** The block's row span, its body's box and content heights. */
async function glance(page: import("@playwright/test").Page) {
  const block = page.getByTestId("report-block-stats");
  await expect(block).toBeVisible();
  return block.evaluate((section) => {
    const body = section.querySelector("[data-arrangement-body]") as HTMLElement;
    const span = /row-span-(\d+)/.exec(section.className);
    return { rows: span ? Number(span[1]) : null, client: body.clientHeight, scroll: body.scrollHeight };
  });
}

/** Seeds a stored Reports board for the e2e project (`e2e-1`, see seed.ts). */
async function seedLayout(page: import("@playwright/test").Page, stats: Record<string, unknown>) {
  const layout = { v: 1, board: [stats, { id: "byPriority", w: 2, h: 1 }], hidden: [] };
  await page.addInitScript(
    ([key, l]) => localStorage.setItem(key as string, JSON.stringify({ "e2e-1": l })),
    [REPORTS_LAYOUT_KEY, layout] as const,
  );
}

test.describe("Reports At a glance adapts its height", () => {
  test("a narrow window grows the block so the wrapped strip does not scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await gotoApp(page);
    await openView(page, "Reports");
    await expect.poll(async () => (await glance(page)).rows).toBeGreaterThan(2);
    const m = await glance(page);
    expect(m.scroll).toBeLessThanOrEqual(m.client);
  });

  test("a wide window keeps it at 2 rows when one row of cells fits", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await gotoApp(page);
    await openView(page, "Reports");
    const m = await glance(page);
    expect(m.rows).toBe(2);
    expect(m.scroll).toBeLessThanOrEqual(m.client);
  });

  test("a block stored at width 2 grows to fit its wrapped strip", async ({ page }) => {
    await seedLayout(page, { id: "stats", w: 2, h: 2 });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await gotoApp(page);
    await openView(page, "Reports");
    await expect.poll(async () => (await glance(page)).rows).toBeGreaterThan(2);
    const m = await glance(page);
    expect(m.scroll).toBeLessThanOrEqual(m.client);
  });

  test("a height the user chose wins over the measurement", async ({ page }) => {
    await seedLayout(page, { id: "stats", w: 2, h: 2, hSet: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await gotoApp(page);
    await openView(page, "Reports");
    const m = await glance(page);
    expect(m.rows).toBe(2);
    // Positive control: at width 2 the strip really does need more than 2 rows,
    // so staying at 2 is the flag at work, not a strip that happens to fit.
    expect(m.scroll).toBeGreaterThan(m.client);
  });
});
