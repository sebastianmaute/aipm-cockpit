import { test, expect, gotoApp, openView } from "./seed";
import { DASHBOARD_LAYOUT_KEY } from "../src/app/dashboard-layout-store";

/**
 * The ONE measurement of the Dashboard grid that no unit test can make.
 *
 * ★★★ jsdom HAS NO LAYOUT ENGINE, so `dashboard-grid.test.tsx` can only assert
 * that a class STRING was rendered. It cannot see whether Tailwind ever EMITTED
 * that class — and an interpolated `col-span-${w}` emits nothing, leaving every
 * tile one column wide with the entire unit suite green. Everything here is
 * therefore read off COMPUTED GEOMETRY (`getComputedStyle` on the container,
 * `getBoundingClientRect` on real tiles); a class-string assertion in this file
 * would prove nothing the unit suite has not already proven.
 *
 * ★ The responsive clamp lives ENTIRELY in `W_CLASS`'s literal `lg:`/`xl:`
 * variants plus the container's `lg:grid-cols-2 xl:grid-cols-4` — there is no
 * width measurement and no ResizeObserver anywhere in the feature. Resizing the
 * viewport mid-test and re-reading the computed style is exactly the right probe
 * for that claim: if any of it were JavaScript, this would be the wrong test.
 */

/** Tailwind's default breakpoints: `lg` = 1024px, `xl` = 1280px. */
const XL = 1600;
const LG = 1100;
const SM = 900;

/** Computed grid-container facts, read in one round trip. */
async function gridMetrics(page: import("@playwright/test").Page) {
  return page.getByTestId("dashboard-grid").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      tracks: cs.gridTemplateColumns.split(/\s+/).filter(Boolean).map(parseFloat),
      autoRows: cs.gridAutoRows,
      autoFlow: cs.gridAutoFlow,
      colGap: parseFloat(cs.columnGap),
      rowGap: parseFloat(cs.rowGap),
      // Content box: the width every column track is resolved against.
      contentWidth: el.clientWidth,
    };
  });
}

async function tileBox(page: import("@playwright/test").Page, id: string) {
  const box = await page.getByTestId(`tile-${id}`).boundingBox();
  expect(box, `tile-${id} is not on the board`).not.toBeNull();
  return box!;
}

test.describe("dashboard grid geometry", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");
  });

  test("resolves to four equal column tracks at xl", async ({ page }) => {
    const m = await gridMetrics(page);
    expect(m.tracks).toHaveLength(4);
    // Equal tracks — a `grid-cols-4` that Tailwind failed to emit would leave a
    // single implicit `auto` track, which the length check already catches; this
    // additionally rules out a partially-applied template.
    for (const w of m.tracks) expect(Math.abs(w - m.tracks[0])).toBeLessThan(1);
    // The four tracks plus three gaps must account for the whole content box.
    const spanned = m.tracks.reduce((a, b) => a + b, 0) + 3 * m.colGap;
    expect(Math.abs(spanned - m.contentWidth)).toBeLessThan(1.5);
  });

  test("clamps to two tracks below xl and one below lg — with no JavaScript", async ({ page }) => {
    await page.setViewportSize({ width: LG, height: 1000 });
    expect((await gridMetrics(page)).tracks).toHaveLength(2);

    await page.setViewportSize({ width: SM, height: 1000 });
    expect((await gridMetrics(page)).tracks).toHaveLength(1);

    // …and back up, to prove the clamp is a live media query rather than a
    // one-way measurement taken at mount.
    await page.setViewportSize({ width: XL, height: 1000 });
    expect((await gridMetrics(page)).tracks).toHaveLength(4);
  });

  test("applies the 80px comfortable row unit to the container AND to a real tile", async ({ page }) => {
    const m = await gridMetrics(page);
    expect(m.autoRows).toBe("80px");

    // ★ The container property alone would not prove the row unit reaches a
    // tile: `row-span-2` is a SECOND literal class table (`H_CLASS`) that
    // Tailwind must also have emitted. A h:2 tile is two row units plus the row
    // gap between them.
    const kpi = await tileBox(page, "kpi"); // catalogue default h: 2
    expect(Math.abs(kpi.height - (2 * 80 + m.rowGap))).toBeLessThan(1.5);
  });

  test("emitted the width-span utilities — a w:4 tile fills the row, a w:2 tile is half", async ({ page }) => {
    // ★★★ THIS IS THE FAILURE MODE THAT IS INVISIBLE EVERYWHERE ELSE. If
    // `W_CLASS` were built by interpolation, Tailwind would emit no rule, every
    // tile would fall back to a single implicit column, and this is the only
    // assertion in the repo that would notice.
    const m = await gridMetrics(page);
    const kpi = await tileBox(page, "kpi");           // catalogue default w: 4
    const upcoming = await tileBox(page, "upcoming"); // catalogue default w: 2

    expect(Math.abs(kpi.width - m.contentWidth)).toBeLessThan(1.5);
    expect(Math.abs(upcoming.width - (m.contentWidth - m.colGap) / 2)).toBeLessThan(1.5);
    // Blunt sanity check: a one-column-wide collapse makes both roughly equal.
    expect(kpi.width).toBeGreaterThan(upcoming.width * 1.8);
  });
});

/**
 * Dense packing, measured rather than asserted as a class.
 *
 * ★★ `grid-auto-flow: row dense` is what makes ORDER the entire placement model
 * — a tile too wide for the tail of a row moves down, and a LATER tile that
 * fits backfills the hole it left. A `toHaveCSS("grid-auto-flow", "row dense")`
 * assertion proves the declaration exists; it does not prove any tile ever
 * backfills. This seeds an arrangement whose only correct rendering REQUIRES the
 * backfill, then reads the resulting tops.
 *
 * Seeded board (all three are ungated catalogue tiles, and every span is inside
 * its own min/max so `reconcile` cannot clamp it):
 *   1. upcoming w2 h2 → rows 1-2, cols 1-2
 *   2. kpi      w4 h2 → cannot fit the two free columns, so rows 3-4
 *   3. progress w2 h2 → dense pulls it UP into rows 1-2, cols 3-4
 * Without `dense` it would sit at rows 5-6, below kpi.
 *
 * ★ Every other tile is HIDDEN, not merely omitted: `reconcile` re-inserts any
 * catalogue tile that is absent from both lists, next to its nearest present
 * catalogue neighbour — which would silently rewrite this order.
 */
const DENSE_LAYOUT = {
  v: 1,
  board: [
    { id: "upcoming", w: 2, h: 2 },
    { id: "kpi", w: 4, h: 2 },
    { id: "progress", w: 2, h: 2 },
  ],
  hidden: [
    "topActions", "insights", "raid", "trends",
    "burn", "milestones", "changes", "completionTrend",
  ],
};

test.describe("dashboard grid dense packing", () => {
  test("a later tile backfills the gap an over-wide tile left behind", async ({ page }) => {
    // ★ `e2e-1` is the project id the registry seed in seed.ts installs, and
    // workspace-section passes `currentProjectId` straight through — a layout
    // stored under any other key is loaded by nothing and this test would
    // silently measure the DEFAULT arrangement instead.
    await page.addInitScript(
      ([key, layout]) => {
        localStorage.setItem(key as string, JSON.stringify({ "e2e-1": layout }));
      },
      [DASHBOARD_LAYOUT_KEY, DENSE_LAYOUT] as const,
    );
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");

    // Guard: the seed has to have taken. If reconcile rewrote the board, the
    // hidden tiles would still be on it and the tops below would compare the
    // wrong things.
    await expect(page.getByTestId("tile-raid")).toHaveCount(0);

    const upcoming = await tileBox(page, "upcoming");
    const kpi = await tileBox(page, "kpi");
    const progress = await tileBox(page, "progress");

    // DOM order is upcoming → kpi → progress; only dense packing can put the
    // third one level with the first.
    expect(Math.abs(progress.y - upcoming.y)).toBeLessThan(1.5);
    expect(progress.y).toBeLessThan(kpi.y);
    // …and it lands in the columns kpi vacated, not on top of upcoming.
    expect(progress.x).toBeGreaterThan(upcoming.x + upcoming.width - 1.5);
  });
});
